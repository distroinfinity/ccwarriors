import { describe, it, expect } from "vitest";
import { createApp, type AppDeps } from "../src/app.js";
import { LeaderboardStore, type Entry } from "../src/lib/leaderboard-store.js";

describe("health", () => {
  it("GET /health returns ok", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

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

function makeApp(corsOrigin?: string) {
  const store = new LeaderboardStore();
  const deps: AppDeps = { db: {} as AppDeps["db"], store, onIngest: () => {}, corsOrigin };
  return { app: createApp(deps), store };
}

describe("leaderboard org filter", () => {
  it("?org=ns returns only org members and echoes the org", async () => {
    const { app, store } = makeApp();
    store.upsert(entry("a", { cost30d: 100, orgs: ["ns"] }));
    store.upsert(entry("b", { cost30d: 60 }));

    const res = await app.request("/leaderboard?org=ns");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      org: string;
      count: number;
      entries: Entry[];
      totals: { burned30d: number; count: number };
    };
    expect(body.org).toBe("ns");
    expect(body.count).toBe(1);
    expect(body.entries.map((e) => e.id)).toEqual(["a"]);
    // Org-scoped headline numbers for the org page header.
    expect(body.totals).toEqual({ burned30d: 100, count: 1 });
  });

  it("unknown org 400s instead of leaking the global board", async () => {
    const { app } = makeApp();
    const res = await app.request("/leaderboard?org=nope");
    expect(res.status).toBe(400);
  });

  it("global board carries orgs on entries for badges", async () => {
    const { app, store } = makeApp();
    store.upsert(entry("a", { cost30d: 100, orgs: ["ns"] }));
    const res = await app.request("/leaderboard");
    const body = (await res.json()) as { org: string | null; entries: Entry[] };
    expect(body.org).toBeNull();
    expect(body.entries[0]!.orgs).toEqual(["ns"]);
  });
});

describe("cors", () => {
  it("allows configured origins and any *.ccwarriors.xyz subdomain", async () => {
    const { app } = makeApp("https://ccwarriors.xyz");
    for (const origin of ["https://ccwarriors.xyz", "https://ns.ccwarriors.xyz"]) {
      const res = await app.request("/health", { headers: { Origin: origin } });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("rejects unknown origins when not wildcard", async () => {
    const { app } = makeApp("https://ccwarriors.xyz");
    const res = await app.request("/health", { headers: { Origin: "https://evil.com" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps CORS headers on cached leaderboard 304 responses", async () => {
    const { app, store } = makeApp("https://ccwarriors.xyz");
    store.upsert(entry("a", { cost30d: 100 }));
    const origin = "https://ns.ccwarriors.xyz";

    const first = await app.request("/leaderboard", { headers: { Origin: origin } });
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=5");
    expect(first.headers.get("access-control-allow-origin")).toBe(origin);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const cached = await app.request("/leaderboard", {
      headers: { Origin: origin, "If-None-Match": etag! },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("access-control-allow-origin")).toBe(origin);
  });
});
