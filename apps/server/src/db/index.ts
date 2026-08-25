import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { instrumentDrizzleClient } from "@kubiks/otel-drizzle";
import postgres from "postgres";
import * as schema from "./schema.js";

export type DB = ReturnType<typeof createDb>;

export function createDb(url: string) {
  // Small pool: traffic is one sync per machine every ~15 min plus board reads
  // served from memory. postgres-js defaults to 10 connections, and each idle
  // Postgres backend is real RSS on a memory-billed host. idle_timeout returns
  // backends between bursts.
  const client = postgres(url, { max: 4, idle_timeout: 30 });
  return drizzlePg(client, { schema });
}

// Test-only: in-memory Postgres via PGlite, migrated from ./drizzle.
// Picks a driver from the environment: real Postgres when DATABASE_URL is set
// (production / Railway), otherwise in-memory PGlite (local dev + zero-setup demo).
export async function createDbFromEnv(databaseUrl?: string): Promise<DB> {
  const db = databaseUrl ? createDb(databaseUrl) : await createTestDb();
  // drizzle-orm ships a tracer at drizzle-orm/tracing, but its
  // `await import('@opentelemetry/api')` is commented out in the published
  // source (still true in 0.45.2), so it can never emit a span. This wraps the
  // session instead. No-ops when no SDK is registered.
  instrumentDrizzleClient(db, { dbSystem: "postgresql" });
  return db;
}

export async function createTestDb(): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // PGLITE_DIR persists the local DB to disk so a dev/test server restart keeps
  // its data (e.g. a local e2e enlistment). Unset = ephemeral in-memory (CI/tests).
  const dir = process.env["PGLITE_DIR"];
  const client = dir ? new PGlite(dir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  return db as unknown as DB;
}
