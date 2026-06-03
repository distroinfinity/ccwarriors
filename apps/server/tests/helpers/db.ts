import { createTestDb } from "../../src/db/index.js";
import { users } from "../../src/db/schema.js";
import { hashToken } from "../../src/lib/token.js";

export async function makeDb() {
  return createTestDb();
}

export async function seedUser(
  db: Awaited<ReturnType<typeof createTestDb>>,
  opts: { login: string; token: string; githubId?: string },
) {
  const [row] = await db
    .insert(users)
    .values({
      githubId: opts.githubId ?? opts.login,
      githubLogin: opts.login,
      cliTokenHash: hashToken(opts.token),
    })
    .returning();
  return row;
}
