import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { authRoute } from "../src/routes/auth.js";
import { sign } from "../src/lib/session.js";
import { makeDb } from "./helpers/db.js";
import { users } from "../src/db/schema.js";

// The OAuth access token (read:user scope) is persisted at login so the
// server can read the user's PUBLIC GitHub stats later. Success path only.

const CFG = {
  clientId: "cid",
  clientSecret: "csecret",
  publicBaseUrl: "https://api.test",
  webBaseUrl: "https://web.test",
};

describe("github oauth callback persists the access token", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
    vi.stubGlobal(
      "fetch",
      (async (url: string | URL) => {
        const u = String(url);
        if (u.includes("login/oauth/access_token")) {
          return new Response(JSON.stringify({ access_token: "gho_persisted" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (u.includes("api.github.com/user")) {
          return new Response(
            JSON.stringify({ id: 12345, login: "tokenuser", avatar_url: "https://a/img.png" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch ${u}`);
      }) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cli login stores githubAccessToken on the user row", async () => {
    const app = authRoute(db, CFG);
    const state = sign({ mode: "cli", port: 4242, nonce: "n" }, CFG.clientSecret);
    const res = await app.request(`/cli/callback?code=abc&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("127.0.0.1:4242");

    const [row] = await db.select().from(users).where(eq(users.githubId, "12345"));
    expect(row?.githubAccessToken).toBe("gho_persisted");
  });

  it("web re-login refreshes the token on the existing row", async () => {
    const app = authRoute(db, CFG);
    const cli = sign({ mode: "cli", port: 4242, nonce: "n1" }, CFG.clientSecret);
    await app.request(`/cli/callback?code=abc&state=${encodeURIComponent(cli)}`);
    await db.update(users).set({ githubAccessToken: null }).where(eq(users.githubId, "12345"));

    const web = sign({ mode: "web", nonce: "n2" }, CFG.clientSecret);
    const res = await app.request(`/cli/callback?code=def&state=${encodeURIComponent(web)}`);
    expect(res.status).toBe(302);

    const [row] = await db.select().from(users).where(eq(users.githubId, "12345"));
    expect(row?.githubAccessToken).toBe("gho_persisted");
  });
});
