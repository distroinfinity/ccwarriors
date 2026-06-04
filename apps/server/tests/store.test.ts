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
});
