// Revive the local profile+story for distroinfinity: real app, real story
// generator (ANTHROPIC_API_KEY from .env), seeded auth token (no OAuth hop).
import { serve } from "@hono/node-server";
const { createApp } = await import("./dist/app.js");
const { createDbFromEnv } = await import("./dist/db/index.js");
const { users } = await import("./dist/db/schema.js");
const { LeaderboardStore } = await import("./dist/lib/leaderboard-store.js");
const { InsightsStore } = await import("./dist/lib/insights-store.js");
const { hashToken } = await import("./dist/lib/token.js");
const { generateStory } = await import("./dist/lib/story.js");

const db = await createDbFromEnv(undefined);
await db.insert(users).values({
  githubId: "59890794",
  githubLogin: "distroinfinity",
  avatarUrl: "https://avatars.githubusercontent.com/u/59890794?v=4",
  cliTokenHash: hashToken("devtoken"),
  insightsConsent: true,
  insightsMode: "deep",
  consentVersion: 2,
  // Stands in for the token OAuth login would have stored — powers gh stats.
  githubAccessToken: process.env.SEED_GH_TOKEN || null,
}).onConflictDoNothing();

// Restore the already-generated story so a restart doesn't re-bill Claude.
try {
  const { readFileSync } = await import("node:fs");
  const saved = JSON.parse(readFileSync("/tmp/ccw-local/story-distroinfinity.json", "utf8"));
  const { userStories } = await import("./dist/db/schema.js");
  const { eq } = await import("drizzle-orm");
  const [u] = await db.select().from(users).where(eq(users.githubLogin, "distroinfinity"));
  await db.insert(userStories).values({ userId: u.id, doc: saved.story, model: "claude-opus-4-8" }).onConflictDoNothing();
  console.log("saved story restored");
} catch { console.log("no saved story to restore"); }

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error("no ANTHROPIC_API_KEY"); process.exit(1); }
const app = createApp({
  db,
  store: new LeaderboardStore(),
  insightsStore: new InsightsStore(),
  onIngest: () => {},
  corsOrigin: "http://localhost:5173",
  githubToken: process.env.GITHUB_TOKEN,
  storyGenerate: (login, source) => generateStory({ apiKey }, login, source),
});
serve({ fetch: app.fetch, port: 8807 }, () => console.log("story-revival server on :8807"));
