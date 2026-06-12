import { describe, expect, it } from "vitest";
import { LeaderboardStore, type Entry } from "../src/lib/leaderboard-store.js";

const entry = (id: string, over: Partial<Entry> = {}): Entry => ({
  id,
  githubLogin: id,
  avatarUrl: "",
  xHandle: null,
  tier: "Stone",
  cardScene: "fujiNight",
  cost30d: 0,
  costAllTime: 0,
  ...over,
});

describe("LeaderboardStore (multi-tool)", () => {
  it("ranks per-tool boards by that tool's cost and excludes zero users", () => {
    const store = new LeaderboardStore();
    store.upsert(entry("a", { cost30d: 100, breakdown: { claude: 90, codex: 10 } }));
    store.upsert(entry("b", { cost30d: 60, breakdown: { codex: 60 } }));
    store.upsert(entry("c", { cost30d: 50, breakdown: { claude: 50 } }));

    expect(store.getTop("30d", 10).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(store.getTop("30d", 10, 0, "codex").map((e) => e.id)).toEqual(["b", "a"]);
    expect(store.getTop("30d", 10, 0, "claude").map((e) => e.id)).toEqual(["a", "c"]);
    expect(store.getRank("30d", "c", "codex")).toBeNull();
    expect(store.getRank("30d", "b", "codex")).toBe(1);
  });

  it("excludes flagged users from boards, counts, totals, and tool summaries", () => {
    const store = new LeaderboardStore();
    store.upsert(entry("ok", { cost30d: 10, breakdown: { claude: 10 } }));
    store.upsert(entry("rigger", { cost30d: 99_999, breakdown: { codex: 99_999 }, flagged: true }));

    expect(store.getTop("30d", 10).map((e) => e.id)).toEqual(["ok"]);
    expect(store.count()).toBe(1);
    expect(store.totals()).toEqual({ burned30d: 10, count: 1 });
    expect(store.toolSummaries().map((t) => t.key)).toEqual(["claude"]);
    expect(store.getRank("30d", "rigger")).toBeNull();

    store.setFlagged("rigger", false);
    expect(store.count()).toBe(2);
  });

  it("filters boards, counts, and totals to an org's members", () => {
    const store = new LeaderboardStore();
    store.upsert(entry("a", { cost30d: 100, orgs: ["ns"] }));
    store.upsert(entry("b", { cost30d: 60 }));
    store.upsert(entry("c", { cost30d: 50, orgs: ["ns", "acme"] }));

    expect(store.getTop("30d", 10, 0, undefined, "ns").map((e) => e.id)).toEqual(["a", "c"]);
    expect(store.getTop("30d", 10).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(store.count("ns")).toBe(2);
    expect(store.totals("ns")).toEqual({ burned30d: 150, count: 2 });
    expect(store.getRank("30d", "c", undefined, "ns")).toBe(2);
    expect(store.getRank("30d", "b", undefined, "ns")).toBeNull();
  });

  it("keeps flagged users off org boards and lets setOrgs grant membership live", () => {
    const store = new LeaderboardStore();
    store.upsert(entry("ok", { cost30d: 10, orgs: ["ns"] }));
    store.upsert(entry("rigger", { cost30d: 99_999, orgs: ["ns"], flagged: true }));
    store.upsert(entry("new", { cost30d: 5 }));

    expect(store.getTop("30d", 10, 0, undefined, "ns").map((e) => e.id)).toEqual(["ok"]);
    expect(store.count("ns")).toBe(1);

    store.setOrgs("new", ["ns"]);
    expect(store.getTop("30d", 10, 0, undefined, "ns").map((e) => e.id)).toEqual(["ok", "new"]);
    expect(store.get("new")?.orgs).toEqual(["ns"]);
  });

  it("summarizes tools by user count, descending", () => {
    const store = new LeaderboardStore();
    store.upsert(entry("a", { cost30d: 1, breakdown: { claude: 1 } }));
    store.upsert(entry("b", { cost30d: 2, breakdown: { claude: 1, codex: 1 } }));
    store.upsert(entry("c", { cost30d: 3, breakdown: { codex: 2, gemini: 1 } }));
    expect(store.toolSummaries()).toEqual([
      { key: "claude", count: 2 },
      { key: "codex", count: 2 },
      { key: "gemini", count: 1 },
    ]);
  });

  it("breaks ties by lastSyncedAt asc then login asc — order is stable regardless of upsert order", () => {
    // Two entries with identical cost30d and costAllTime; "early" synced first.
    const t1 = 1_000_000;
    const t2 = 2_000_000;

    // Upsert order A: early first
    const storeA = new LeaderboardStore();
    storeA.upsert(entry("early", { cost30d: 50, costAllTime: 100, lastSyncedAt: t1 }));
    storeA.upsert(entry("late", { cost30d: 50, costAllTime: 100, lastSyncedAt: t2 }));

    // Upsert order B: late first
    const storeB = new LeaderboardStore();
    storeB.upsert(entry("late", { cost30d: 50, costAllTime: 100, lastSyncedAt: t2 }));
    storeB.upsert(entry("early", { cost30d: 50, costAllTime: 100, lastSyncedAt: t1 }));

    const orderA = storeA.getTop("30d", 10).map((e) => e.id);
    const orderB = storeB.getTop("30d", 10).map((e) => e.id);

    // "got there first" wins — earlier sync is rank 1.
    expect(orderA).toEqual(["early", "late"]);
    // Identical regardless of upsert order.
    expect(orderB).toEqual(orderA);
  });

  it("falls back to login asc when lastSyncedAt is identical", () => {
    const t = 1_000_000;
    const store = new LeaderboardStore();
    store.upsert(entry("zebra", { cost30d: 50, costAllTime: 100, lastSyncedAt: t }));
    store.upsert(entry("alpha", { cost30d: 50, costAllTime: 100, lastSyncedAt: t }));

    expect(store.getTop("30d", 10).map((e) => e.id)).toEqual(["alpha", "zebra"]);
  });
});
