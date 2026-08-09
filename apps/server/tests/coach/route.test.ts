import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { profileRoute } from "../../src/routes/profile.js";
import { InsightsStore } from "../../src/lib/insights-store.js";
import { LeaderboardStore } from "../../src/lib/leaderboard-store.js";
import { clearBenchmarkCache } from "../../src/lib/coach/benchmark.js";
import { makeDb, seedUser } from "../helpers/db.js";
import { users, usageDays } from "../../src/db/schema.js";

beforeEach(() => clearBenchmarkCache());

function app(db: Awaited<ReturnType<typeof makeDb>>) {
  return profileRoute({ db, store: new LeaderboardStore(), insightsStore: new InsightsStore() });
}

describe("GET /profile/:login/coach", () => {
  it("404s an unknown login", async () => {
    const db = await makeDb();
    const res = await app(db).request("/badlogin/coach");
    expect(res.status).toBe(404);
  });

  it("locks when the user has not consented", async () => {
    const db = await makeDb();
    await seedUser(db, { login: "noconsent", token: "t" });
    const res = await app(db).request("/noconsent/coach");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ locked: true, reason: "no_consent" });
  });

  it("returns a public coach payload (no feed) for a consenting public user", async () => {
    const db = await makeDb();
    await seedUser(db, { login: "pubuser", token: "t" });
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "public", insightsMode: "off" })
      .where(eq(users.githubLogin, "pubuser"));
    const [u] = await db.select().from(users).where(eq(users.githubLogin, "pubuser"));
    await db.insert(usageDays).values({
      userId: u!.id, machineId: "m", tool: "claude", day: new Date().toISOString().slice(0, 10),
      inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000,
      cost: "10", modelBreakdown: [{ modelName: "claude-opus-4-7", inputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 1_000_000 }],
    });
    const res = await app(db).request("/pubuser/coach");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isOwner: boolean; recommendations: unknown[]; modules: { visibility: string }[] };
    expect(body.isOwner).toBe(false);
    expect(body.recommendations).toEqual([]);
    expect(body.modules.every((m: { visibility: string }) => m.visibility === "public")).toBe(true);
    expect(res.headers.get("Cache-Control")).toContain("public");
  });

  it("locks a private profile for a non-owner", async () => {
    const db = await makeDb();
    await seedUser(db, { login: "secret", token: "t" });
    await db.update(users).set({ insightsConsent: true, insightsVisibility: "private" })
      .where(eq(users.githubLogin, "secret"));
    const res = await app(db).request("/secret/coach");
    expect(await res.json()).toEqual({ locked: true, reason: "no_consent" });
  });
});
