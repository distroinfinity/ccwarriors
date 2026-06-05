import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { makeDb, seedUser } from "./helpers/db.js";
import { orgsRoute, orgWebUrl, type DiscordCfg } from "../src/routes/orgs.js";
import { LeaderboardStore, type Entry } from "../src/lib/leaderboard-store.js";
import { orgMembers } from "../src/db/schema.js";
import { createSessionToken } from "../src/lib/session.js";

const SECRET = "test-secret";
const GUILD = "guild-ns-123";

const cfg: DiscordCfg = {
  clientId: "discord-client",
  clientSecret: "discord-secret",
  sessionSecret: SECRET,
  publicBaseUrl: "https://api.ccwarriors.xyz",
  webBaseUrl: "https://ccwarriors.xyz",
};

const entry = (id: string, login: string): Entry => ({
  id,
  githubLogin: login,
  avatarUrl: "",
  xHandle: null,
  tier: "Stone",
  cardScene: "fujiNight",
  cost30d: 10,
  costAllTime: 10,
});

function sessionCookie(githubId: string): string {
  const tok = createSessionToken({ login: "manu", avatarUrl: "", githubId }, SECRET);
  return `ccw_session=${tok}`;
}

// Mocked Discord API: token exchange, identity, guild list.
function stubDiscord(guildIds: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "atok" }), { status: 200 });
      }
      if (url.includes("/users/@me/guilds")) {
        return new Response(JSON.stringify(guildIds.map((id) => ({ id }))), { status: 200 });
      }
      if (url.includes("/users/@me")) {
        return new Response(JSON.stringify({ id: "discord-user-1" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

describe("org verification (Discord OAuth)", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;
  let store: LeaderboardStore;
  let app: Hono;
  let changed: number;

  beforeEach(async () => {
    process.env["NS_GUILD_ID"] = GUILD;
    db = await makeDb();
    store = new LeaderboardStore();
    changed = 0;
    app = new Hono();
    app.route("/", orgsRoute(db, store, cfg, () => changed++));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["NS_GUILD_ID"];
  });

  it("verify/start without a session redirects to GitHub web login", async () => {
    const res = await app.request("/orgs/ns/verify/start");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://api.ccwarriors.xyz/auth/web?org=ns");
  });

  it("verify/start with a session redirects to Discord authorize with state", async () => {
    const res = await app.request("/orgs/ns/verify/start", {
      headers: { Cookie: sessionCookie("gh-1") },
    });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://discord.com/api/oauth2/authorize");
    expect(loc.searchParams.get("client_id")).toBe("discord-client");
    expect(loc.searchParams.get("scope")).toBe("identify guilds");
    expect(loc.searchParams.get("redirect_uri")).toBe("https://api.ccwarriors.xyz/discord/callback");
    expect(loc.searchParams.get("state")).toBeTruthy();
  });

  it("verify/start for an unknown org 404s", async () => {
    const res = await app.request("/orgs/nope/verify/start", {
      headers: { Cookie: sessionCookie("gh-1") },
    });
    expect(res.status).toBe(404);
  });

  it("callback verifies a guild member: membership row, live store orgs, ?verified=1", async () => {
    const user = (await seedUser(db, { login: "manu", token: "t", githubId: "gh-1" }))!;
    store.upsert(entry(user.id, "manu"));
    stubDiscord(["other-guild", GUILD]);

    const start = await app.request("/orgs/ns/verify/start", {
      headers: { Cookie: sessionCookie("gh-1") },
    });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;

    const res = await app.request(`/discord/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("ns.ccwarriors.xyz");
    expect(loc.searchParams.get("verified")).toBe("1");

    const rows = await db.select().from(orgMembers).where(eq(orgMembers.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgSlug).toBe("ns");
    expect(rows[0]!.discordUserId).toBe("discord-user-1");
    expect(store.get(user.id)?.orgs).toEqual(["ns"]);
    expect(changed).toBe(1);
  });

  it("callback for a non-member redirects ?verified=notmember and stores nothing", async () => {
    const user = (await seedUser(db, { login: "manu", token: "t", githubId: "gh-1" }))!;
    store.upsert(entry(user.id, "manu"));
    stubDiscord(["other-guild"]);

    const start = await app.request("/orgs/ns/verify/start", {
      headers: { Cookie: sessionCookie("gh-1") },
    });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;

    const res = await app.request(`/discord/callback?code=abc&state=${encodeURIComponent(state)}`);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("verified")).toBe("notmember");
    expect(await db.select().from(orgMembers)).toHaveLength(0);
    expect(store.get(user.id)?.orgs).toBeUndefined();
    expect(changed).toBe(0);
  });

  it("callback with a forged state 400s", async () => {
    const res = await app.request("/discord/callback?code=abc&state=evil.sig");
    expect(res.status).toBe(400);
  });

  it("callback without a code (user denied) redirects ?verified=failed", async () => {
    const start = await app.request("/orgs/ns/verify/start", {
      headers: { Cookie: sessionCookie("gh-1") },
    });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await app.request(`/discord/callback?state=${encodeURIComponent(state)}`);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("verified")).toBe("failed");
  });

  it("re-verifying is idempotent (single membership row)", async () => {
    const user = (await seedUser(db, { login: "manu", token: "t", githubId: "gh-1" }))!;
    store.upsert(entry(user.id, "manu"));
    stubDiscord([GUILD]);

    for (let i = 0; i < 2; i++) {
      const start = await app.request("/orgs/ns/verify/start", {
        headers: { Cookie: sessionCookie("gh-1") },
      });
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      await app.request(`/discord/callback?code=abc&state=${encodeURIComponent(state)}`);
    }
    expect(await db.select().from(orgMembers)).toHaveLength(1);
    expect(store.get(user.id)?.orgs).toEqual(["ns"]);
  });
});

describe("web GitHub login from an org page", () => {
  function stubGithub() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("github.com/login/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "gh-atok" }), { status: 200 });
        }
        if (url.includes("api.github.com/user")) {
          return new Response(
            JSON.stringify({ id: 7, login: "manu", avatar_url: "https://a.png" }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  }

  it("?org=ns rides through OAuth and lands back on the org subdomain", async () => {
    const db = await makeDb();
    stubGithub();
    const { authRoute } = await import("../src/routes/auth.js");
    const app = new Hono();
    app.route(
      "/",
      authRoute(db, {
        clientId: "gh",
        clientSecret: SECRET,
        publicBaseUrl: "https://api.ccwarriors.xyz",
        webBaseUrl: "https://ccwarriors.xyz",
      }),
    );

    const start = await app.request("/auth/web?org=ns");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await app.request(`/cli/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("ns.ccwarriors.xyz");
    expect(loc.searchParams.get("u")).toBe("manu");
    vi.unstubAllGlobals();
  });

  it("without ?org the web login still lands on the apex", async () => {
    const db = await makeDb();
    stubGithub();
    const { authRoute } = await import("../src/routes/auth.js");
    const app = new Hono();
    app.route(
      "/",
      authRoute(db, {
        clientId: "gh",
        clientSecret: SECRET,
        publicBaseUrl: "https://api.ccwarriors.xyz",
        webBaseUrl: "https://ccwarriors.xyz",
      }),
    );
    const start = await app.request("/auth/web");
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const res = await app.request(`/cli/callback?code=abc&state=${encodeURIComponent(state)}`);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.hostname).toBe("ccwarriors.xyz");
    expect(loc.searchParams.get("u")).toBe("manu");
    vi.unstubAllGlobals();
  });
});

describe("GET /me org membership", () => {
  it("returns verified org slugs so the site can skip the verify CTA", async () => {
    const db = await makeDb();
    const user = (await seedUser(db, { login: "manu", token: "t", githubId: "gh-1" }))!;
    await db.insert(orgMembers).values({ userId: user.id, orgSlug: "ns", discordUserId: "d1" });

    const { authRoute } = await import("../src/routes/auth.js");
    const app = new Hono();
    app.route(
      "/",
      authRoute(db, {
        clientId: "gh",
        clientSecret: SECRET,
        publicBaseUrl: "https://api.ccwarriors.xyz",
        webBaseUrl: "https://ccwarriors.xyz",
      }),
    );
    const res = await app.request("/me", { headers: { Cookie: sessionCookie("gh-1") } });
    const body = (await res.json()) as { login: string; orgs?: string[] };
    expect(body.login).toBe("manu");
    expect(body.orgs).toEqual(["ns"]);
  });
});

describe("orgWebUrl", () => {
  it("inserts the org subdomain in production", () => {
    expect(orgWebUrl("https://ccwarriors.xyz", "ns", { verified: "1" })).toBe(
      "https://ns.ccwarriors.xyz/?verified=1",
    );
  });

  it("falls back to ?org= on localhost", () => {
    const url = new URL(orgWebUrl("http://localhost:5173", "ns", { verified: "1" }));
    expect(url.hostname).toBe("localhost");
    expect(url.searchParams.get("org")).toBe("ns");
    expect(url.searchParams.get("verified")).toBe("1");
  });
});
