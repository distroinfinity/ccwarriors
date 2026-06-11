import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { tierOf } from "../src/lib/craft-score.js";
import { insightsRoute } from "../src/routes/insights.js";
import { profileRoute } from "../src/routes/profile.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, userDeepSessions, type SessionRecord } from "../src/db/schema.js";

// Craft tiers (forge names, our own brand): Apprentice <40, Journeyman 40-59,
// Artisan 60-79, Mastersmith 80+. Pins: owner curates ≤4 cards to lead the deck.
// Extras: payload-level signals; topPrompt TEXT is gated on consent v2.

describe("tierOf", () => {
  it("maps scores to forge tiers", () => {
    expect(tierOf(0)).toEqual({ key: "apprentice", name: "Apprentice" });
    expect(tierOf(39.9)).toEqual({ key: "apprentice", name: "Apprentice" });
    expect(tierOf(40)).toEqual({ key: "journeyman", name: "Journeyman" });
    expect(tierOf(59.9)).toEqual({ key: "journeyman", name: "Journeyman" });
    expect(tierOf(60)).toEqual({ key: "artisan", name: "Artisan" });
    expect(tierOf(72)).toEqual({ key: "artisan", name: "Artisan" });
    expect(tierOf(80)).toEqual({ key: "mastersmith", name: "Mastersmith" });
    expect(tierOf(100)).toEqual({ key: "mastersmith", name: "Mastersmith" });
  });
});

function record(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    startHour: 10,
    durationMinutes: 30,
    prompts: 4,
    interrupts: 0,
    usedPlanMode: false,
    exploreBeforeFirstEdit: false,
    hadEdits: true,
    subagentSpawns: 0,
    maxParallel: 0,
    editCalls: 2,
    assistantTurns: 8,
    wordBuckets: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
    model: "claude-opus-4-8",
    timing: { events: 9, medianGapMs: 1200, p10GapMs: 200, subSecondFraction: 0.1 },
    git: null,
    ...over,
  };
}

const TOKEN = "tok_extras";
const MID = "ab12cd34ef56ab78";
const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

describe("deep extras + consent gating", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
    const u = (await seedUser(db, { login: "extras", token: TOKEN }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
  });

  async function upload(body: Record<string, unknown>) {
    const app = insightsRoute({ db, insightsStore: store });
    return app.request("/deep", { method: "POST", headers: auth, body: JSON.stringify(body) });
  }

  it("stores maxConcurrentSessions, drops topPrompt below consent v2", async () => {
    const res = await upload({
      machineId: MID,
      windowDays: 40,
      sessions: [record()],
      maxConcurrentSessions: 7,
      topPrompt: { text: "implement the plan", count: 6, sessions: 3 },
    });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(userDeepSessions);
    expect(row?.extras?.maxConcurrentSessions).toBe(7);
    expect(row?.extras?.topPrompt).toBeUndefined(); // consentVersion null → text dropped
  });

  it("accepts topPrompt once the user acknowledged consent v2", async () => {
    const app = insightsRoute({ db, insightsStore: store });
    const ack = await app.request("/consent", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ consentVersion: 2 }),
    });
    expect(ack.status).toBe(200);

    await upload({
      machineId: MID,
      windowDays: 40,
      sessions: [record({ thankYous: 2, wordTotal: 40, recovery: { loops: 1, medianBreakoutMs: 60000 }, extensions: { ts: 3 } })],
      maxConcurrentSessions: 3,
      topPrompt: { text: "implement the plan", count: 6, sessions: 3 },
    });
    const [row] = await db.select().from(userDeepSessions);
    expect(row?.extras?.topPrompt).toEqual({ text: "implement the plan", count: 6, sessions: 3 });
    expect(row?.sessions[0]?.thankYous).toBe(2); // new optional fields persist
  });

  it("old-client payloads (no new fields) still validate", async () => {
    const res = await upload({ machineId: MID, windowDays: 40, sessions: [record()] });
    expect(res.status).toBe(200);
  });
});

describe("pinned cards", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: InsightsStore;

  beforeEach(async () => {
    db = await makeDb();
    store = new InsightsStore();
    const u = (await seedUser(db, { login: "pinner", token: TOKEN }))!;
    await db.update(users).set({ insightsConsent: true, insightsMode: "deep" }).where(eq(users.id, u.id));
  });

  it("owner sets pins; profile deck leads with them", async () => {
    const app = insightsRoute({ db, insightsStore: store });
    // Upload enough signal that several cards emit.
    await app.request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions: [record(), record(), record()] }),
    });

    const pin = await app.request("/pins", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ pins: ["plan_mode", "model"] }),
    });
    expect(pin.status).toBe(200);

    const pApp = profileRoute({ db, store: new LeaderboardStore(), insightsStore: store, githubToken: null });
    const body = (await (await pApp.request("/pinner")).json()) as {
      insights: { locked: boolean; cards: Array<{ key: string }>; pinnedCards?: string[] };
    };
    expect(body.insights.locked).toBe(false);
    expect(body.insights.cards[0]?.key).toBe("plan_mode");
    expect(body.insights.cards[1]?.key).toBe("model");
    expect(body.insights.pinnedCards).toEqual(["plan_mode", "model"]);
  });

  it("rejects more than 4 pins and unknown keys", async () => {
    const app = insightsRoute({ db, insightsStore: store });
    const tooMany = await app.request("/pins", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ pins: ["a", "b", "c", "d", "e"] }),
    });
    expect(tooMany.status).toBe(400);
    const unknown = await app.request("/pins", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ pins: ["not_a_card"] }),
    });
    expect(unknown.status).toBe(400);
  });
});
