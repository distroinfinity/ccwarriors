import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url);
  return drizzlePg(client, { schema });
}

// Test-only: in-memory Postgres via PGlite, migrated from ./drizzle.
export async function createTestDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  return db;
}
