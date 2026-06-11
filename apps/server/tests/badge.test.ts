import { describe, it, expect } from "vitest";
import { createApp, type AppDeps } from "../src/app.js";
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

function makeApp() {
  const store = new LeaderboardStore();
  const deps: AppDeps = { db: {} as AppDeps["db"], store, onIngest: () => {} };
  return { app: createApp(deps), store };
}

describe("badge endpoint", () => {
  it("GET /badge/:login.svg renders rank, tier, and 30d burn", async () => {
    const { app, store } = makeApp();
    store.upsert(entry("alice", { tier: "Netherite", cost30d: 1234.56 }));
    store.upsert(entry("bob", { cost30d: 60 }));

    const res = await app.request("/badge/alice.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    // Crawl-cache for ~1h: GitHub's camo proxy re-fetches on expiry.
    expect(res.headers.get("cache-control")).toContain("max-age=3600");
    const svg = await res.text();
    expect(svg).toContain("alice");
    expect(svg).toContain("#1 ·");
    expect(svg).toContain("NETHERITE");
    expect(svg).toContain("$1,235");
    expect(svg).toContain("CCWarriors");
  });

  it("matches login case-insensitively", async () => {
    const { app, store } = makeApp();
    store.upsert(entry("Alice", { cost30d: 10 }));
    const res = await app.request("/badge/alice.svg");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Alice");
  });

  it("unknown user gets a generic enlist badge, still 200", async () => {
    const { app } = makeApp();
    const res = await app.request("/badge/nobody.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain("CCWarriors");
    expect(svg).toContain("enlist");
    expect(svg).not.toMatch(/#\d+ ·/);
  });

  it("flagged user gets the generic enlist badge, not their stats", async () => {
    const { app, store } = makeApp();
    store.upsert(entry("cheater", { cost30d: 9999, flagged: true }));
    const res = await app.request("/badge/cheater.svg");
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).toContain("enlist");
    expect(svg).not.toContain("9999");
    expect(svg).not.toContain("9,999");
  });

  it("escapes hostile login text instead of injecting it into the SVG", async () => {
    const { app } = makeApp();
    const res = await app.request(`/badge/${encodeURIComponent('"><script>')}.svg`);
    expect(res.status).toBe(200);
    const svg = await res.text();
    expect(svg).not.toContain("<script>");
  });
});
