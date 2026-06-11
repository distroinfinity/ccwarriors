// Story lifecycle: throttle → generate → persist → PURGE the raw transcripts.
// The documented promise: source payloads exist only until a story is derived.
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { storySources, userStories, type User } from "../db/schema.js";
import type { StoryGenerate } from "./story.js";

export const STORY_REFRESH_MS = 24 * 60 * 60 * 1000; // at most one generation/day/user

export interface StoryDeps {
  db: DB;
  generate: StoryGenerate;
  now?: () => number;
}

/** Generate (or refresh) one user's story from their stored source. Never throws. */
export async function maybeGenerateStory(deps: StoryDeps, user: User): Promise<void> {
  try {
    const now = deps.now?.() ?? Date.now();
    const [existing] = await deps.db.select().from(userStories).where(eq(userStories.userId, user.id));
    if (existing && now - existing.generatedAt.getTime() < STORY_REFRESH_MS) return;

    const [source] = await deps.db.select().from(storySources).where(eq(storySources.userId, user.id));
    if (!source) return;

    const result = await deps.generate(user.githubLogin, source.payload);
    if (!result) return; // keep the old story; the source stays for a later retry

    await deps.db
      .insert(userStories)
      .values({ userId: user.id, doc: result.doc, model: result.model, generatedAt: new Date(now) })
      .onConflictDoUpdate({
        target: userStories.userId,
        set: { doc: result.doc, model: result.model, generatedAt: new Date(now) },
      });
    // The promise: raw transcripts never outlive the derived story.
    await deps.db.delete(storySources).where(eq(storySources.userId, user.id));
  } catch {
    // Background work must never propagate.
  }
}
