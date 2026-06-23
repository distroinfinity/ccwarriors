import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { authRoute } from "../src/routes/auth.js";
import { createSessionToken } from "../src/lib/session.js";
import { currentBuildId } from "../src/lib/build-id.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users } from "../src/db/schema.js";

// The web "your CLI is out of date" nudge is the only channel that reaches
// clients which can't self-update (pre-self-update installs) OR whose
// self-update silently stalled. /me must flag both: legacy clients (never sent
// a multi-tool breakdown) AND clients pinned to a build that isn't the latest.

const CFG = {
  clientId: "cid",
  clientSecret: "csecret",
  publicBaseUrl: "https://api.test",
  webBaseUrl: "https://web.test",
};

const GH_ID = "555";

async function meFor(db: Awaited<ReturnType<typeof makeDb>>) {
  const app = authRoute(db, CFG);
  const token = createSessionToken(
    { login: "warrior", avatarUrl: "https://a/x.png", githubId: GH_ID },
    CFG.clientSecret,
  );
  const res = await app.request("/me", { headers: { cookie: `ccw_session=${token}` } });
  return res.json() as Promise<{
    outdatedClient?: boolean;
    latestBuildId?: string;
    clientBuildId?: string | null;
  }>;
}

describe("/me outdatedClient", () => {
  let db: Awaited<ReturnType<typeof makeDb>>;

  beforeEach(async () => {
    db = await makeDb();
    await seedUser(db, { login: "warrior", token: "tok", githubId: GH_ID });
  });

  it("flags a legacy client (synced, never sent a breakdown)", async () => {
    await db
      .update(users)
      .set({ hasBreakdown: false, clientBuildId: null, lastSyncedAt: new Date() })
      .where(eq(users.githubId, GH_ID));
    const me = await meFor(db);
    expect(me.outdatedClient).toBe(true);
  });

  it("does NOT flag a client pinned to the current build", async () => {
    await db
      .update(users)
      .set({ hasBreakdown: true, clientBuildId: currentBuildId(), lastSyncedAt: new Date() })
      .where(eq(users.githubId, GH_ID));
    const me = await meFor(db);
    expect(me.outdatedClient).toBe(false);
    expect(me.latestBuildId).toBe(currentBuildId());
  });

  it("flags a self-update-capable client stuck on an old build", async () => {
    await db
      .update(users)
      .set({ hasBreakdown: true, clientBuildId: "0000old", lastSyncedAt: new Date() })
      .where(eq(users.githubId, GH_ID));
    const me = await meFor(db);
    expect(me.outdatedClient).toBe(true);
  });

  it("does NOT flag a user that has never synced", async () => {
    await db
      .update(users)
      .set({ hasBreakdown: false, clientBuildId: null, lastSyncedAt: null })
      .where(eq(users.githubId, GH_ID));
    const me = await meFor(db);
    expect(me.outdatedClient).toBe(false);
  });
});
