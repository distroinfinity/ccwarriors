import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { insightsRoute } from "../src/routes/insights.js";
import { InsightsStore } from "../src/lib/insights-store.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users, userDeepSessions, type SessionRecord } from "../src/db/schema.js";

const TOKEN = "tool-token";
const MID = "a1b2c3d4e5f6";

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
    editCalls: 4,
    assistantTurns: 8,
    wordBuckets: { "1-5": 2, "6-10": 1, "11-25": 1, "26+": 0 },
    model: "gpt-5-codex",
    timing: { events: 9, medianGapMs: 1200, p10GapMs: 200, subSecondFraction: 0.1 },
    git: null,
    ...over,
  };
}

describe("/insights/deep persists tool + skill fields", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  beforeEach(async () => {
    db = await makeDb();
    await seedUser(db, { login: "router", token: TOKEN });
    await db.update(users).set({ insightsMode: "deep", insightsConsent: true }).where(eq(users.githubLogin, "router"));
  });

  const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  const app = () => insightsRoute({ db, insightsStore: new InsightsStore(), store: new LeaderboardStore() });

  it("keeps tool, skillSpawns and skillsUsed in the stored JSONB", async () => {
    const sessions = [
      record({ tool: "codex", skillSpawns: 0, skillsUsed: {} } as Partial<SessionRecord>),
      record({ tool: "claude", skillSpawns: 2, skillsUsed: { "test-driven-development": 2 } } as Partial<SessionRecord>),
    ];
    const res = await app().request("/deep", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ machineId: MID, windowDays: 40, sessions }),
    });
    expect(res.status).toBe(200);

    const [row] = await db.select().from(userDeepSessions);
    const stored = row!.sessions;
    expect(stored.map((s) => s.tool).sort()).toEqual(["claude", "codex"]);
    const claudeRec = stored.find((s) => s.tool === "claude")!;
    expect(claudeRec.skillSpawns).toBe(2);
    expect(claudeRec.skillsUsed).toEqual({ "test-driven-development": 2 });
  });
});
