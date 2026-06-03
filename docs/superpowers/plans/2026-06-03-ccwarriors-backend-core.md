# CCWarriors Backend Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the CCWarriors backend: a Hono API on Node that accepts token-authenticated usage ingests, computes tiers, persists snapshots, serves leaderboard reads, and pushes live updates over WebSocket.

**Architecture:** pnpm monorepo. The server is a Hono app run by `@hono/node-server` with a `ws` WebSocket server attached to the same HTTP server. Data lives in Postgres via Drizzle ORM (postgres-js in prod, PGlite in tests). A small in-memory store holds the current leaderboard for fast reads and broadcasts; Postgres is the source of truth.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Hono, `@hono/node-server`, `ws`, Drizzle ORM, `postgres` (postgres-js), `@electric-sql/pglite`, Zod, Vitest.

**This plan is the dependency root.** Later plans (auth/cards, CLI, frontend) build on these modules. GitHub OAuth and token *issuance* are in Plan 2 — here, ingest authenticates against a `cli_token_hash` that tests seed directly.

---

## File Structure

```
pnpm-workspace.yaml            # workspace globs
package.json                   # root scripts
tsconfig.base.json             # shared TS config
apps/server/
  package.json
  tsconfig.json
  drizzle.config.ts            # drizzle-kit config
  vitest.config.ts
  drizzle/                     # generated SQL migrations
  src/
    config.ts                  # env parsing (zod)
    db/
      schema.ts                # users, snapshots tables
      index.ts                 # createDb (postgres-js) + createTestDb (PGlite)
    lib/
      tier.ts                  # computeTier(cost) -> Tier  (pure)
      token.ts                 # hashToken / verifyToken    (pure)
      leaderboard-store.ts     # in-memory current standings
    services/
      ingest.ts                # validate token, persist, update store
    routes/
      ingest.ts                # POST /ingest
      leaderboard.ts           # GET /leaderboard
    ws/
      broadcast.ts             # ws server + debounced broadcast
    app.ts                     # Hono app factory
    index.ts                   # entrypoint: node-server + ws
  tests/
    tier.test.ts
    token.test.ts
    leaderboard-store.test.ts
    ingest.test.ts
    routes.test.ts
    ws.test.ts
    helpers/db.ts              # test db + seed helpers
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create the workspace manifest**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create the root package.json**

`package.json`:
```json
{
  "name": "ccwarriors",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 3: Create the shared TypeScript config**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "outDir": "dist"
  }
}
```

- [ ] **Step 4: Verify pnpm sees the workspace**

Run: `pnpm install`
Expected: completes with "Done" (no packages yet, creates lockfile).

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo"
```

---

## Task 2: Server package + health route

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/src/app.ts`
- Test: `apps/server/tests/routes.test.ts`

- [ ] **Step 1: Create the server package.json**

`apps/server/package.json`:
```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@hono/zod-validator": "^0.4.0",
    "drizzle-orm": "^0.36.0",
    "hono": "^4.6.0",
    "postgres": "^3.4.0",
    "ws": "^8.18.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.2.0",
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the server tsconfig**

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "types": ["node"] },
  "include": ["src", "tests", "drizzle.config.ts"]
}
```

- [ ] **Step 3: Create the vitest config**

`apps/server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 4: Install dependencies**

Run: `pnpm install`
Expected: installs server deps, updates lockfile.

- [ ] **Step 5: Write the failing test for the health route**

`apps/server/tests/routes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";

describe("health", () => {
  it("GET /health returns ok", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter server test`
Expected: FAIL — cannot find module `../src/app.js`.

- [ ] **Step 7: Implement the minimal app factory**

`apps/server/src/app.ts`:
```ts
import { Hono } from "hono";

export function createApp() {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  return app;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter server test`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "feat(server): scaffold hono app with health route"
```

---

## Task 3: Database schema + test harness

**Files:**
- Create: `apps/server/src/db/schema.ts`
- Create: `apps/server/drizzle.config.ts`
- Create: `apps/server/src/db/index.ts`
- Create: `apps/server/tests/helpers/db.ts`
- Generate: `apps/server/drizzle/*` (migration SQL)

- [ ] **Step 1: Define the Drizzle schema**

`apps/server/src/db/schema.ts`:
```ts
import { pgTable, uuid, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  githubId: text("github_id").notNull().unique(),
  githubLogin: text("github_login").notNull(),
  avatarUrl: text("avatar_url").notNull().default(""),
  xHandle: text("x_handle"),
  cliTokenHash: text("cli_token_hash").notNull(),
  cardScene: text("card_scene").notNull().default("fujiNight"),
  cost30d: numeric("cost_30d").notNull().default("0"),
  costAllTime: numeric("cost_all_time").notNull().default("0"),
  tier: text("tier").notNull().default("Stone"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const snapshots = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  cost30d: numeric("cost_30d").notNull(),
  costAllTime: numeric("cost_all_time").notNull(),
  ccusageVersion: text("ccusage_version").notNull().default(""),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

- [ ] **Step 2: Create the drizzle-kit config**

`apps/server/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
```

- [ ] **Step 3: Generate the initial migration**

Run: `pnpm --filter server db:generate`
Expected: creates `apps/server/drizzle/0000_*.sql` and a `meta/` folder containing `CREATE TABLE "users" ...` and `CREATE TABLE "snapshots" ...`.

- [ ] **Step 4: Implement the db factory (prod + test)**

`apps/server/src/db/index.ts`:
```ts
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
```

- [ ] **Step 5: Write a test that the test-db migrates and is empty**

`apps/server/tests/helpers/db.ts`:
```ts
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
```

`apps/server/tests/db.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeDb } from "./helpers/db.js";
import { users } from "../src/db/schema.js";

describe("test db", () => {
  it("migrates and starts empty", async () => {
    const db = await makeDb();
    const rows = await db.select().from(users);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test (expect failure on missing token module)**

Run: `pnpm --filter server test tests/db.test.ts`
Expected: FAIL — cannot find `../../src/lib/token.js` (created in Task 5). This proves the harness wiring; Task 5 makes it green.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/db apps/server/drizzle apps/server/drizzle.config.ts apps/server/tests/helpers apps/server/tests/db.test.ts
git commit -m "feat(server): drizzle schema + pglite test harness"
```

---

## Task 4: Tier computation (pure)

**Files:**
- Create: `apps/server/src/lib/tier.ts`
- Test: `apps/server/tests/tier.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/tests/tier.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeTier, TIERS } from "../src/lib/tier.js";

describe("computeTier", () => {
  it("maps cost to the right tier", () => {
    expect(computeTier(0)).toBe("Stone");
    expect(computeTier(99.99)).toBe("Stone");
    expect(computeTier(100)).toBe("Iron");
    expect(computeTier(499)).toBe("Iron");
    expect(computeTier(500)).toBe("Gold");
    expect(computeTier(1999)).toBe("Gold");
    expect(computeTier(2000)).toBe("Diamond");
    expect(computeTier(5999)).toBe("Diamond");
    expect(computeTier(6000)).toBe("Netherite");
    expect(computeTier(50000)).toBe("Netherite");
  });
  it("exposes ordered tiers", () => {
    expect(TIERS).toEqual(["Stone", "Iron", "Gold", "Diamond", "Netherite"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter server test tests/tier.test.ts`
Expected: FAIL — cannot find `../src/lib/tier.js`.

- [ ] **Step 3: Implement**

`apps/server/src/lib/tier.ts`:
```ts
export const TIERS = ["Stone", "Iron", "Gold", "Diamond", "Netherite"] as const;
export type Tier = (typeof TIERS)[number];

// Thresholds are placeholders per the spec; tune with real data.
const THRESHOLDS: ReadonlyArray<[number, Tier]> = [
  [6000, "Netherite"],
  [2000, "Diamond"],
  [500, "Gold"],
  [100, "Iron"],
  [0, "Stone"],
];

export function computeTier(cost: number): Tier {
  for (const [min, tier] of THRESHOLDS) {
    if (cost >= min) return tier;
  }
  return "Stone";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter server test tests/tier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/tier.ts apps/server/tests/tier.test.ts
git commit -m "feat(server): tier computation"
```

---

## Task 5: Token hashing (pure)

**Files:**
- Create: `apps/server/src/lib/token.ts`
- Test: `apps/server/tests/token.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/tests/token.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateToken, hashToken, verifyToken } from "../src/lib/token.js";

describe("token", () => {
  it("generates a 64-char hex token", () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });
  it("hash is stable and verifies", () => {
    const t = generateToken();
    const h = hashToken(t);
    expect(hashToken(t)).toBe(h);
    expect(verifyToken(t, h)).toBe(true);
    expect(verifyToken("wrong", h)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter server test tests/token.test.ts`
Expected: FAIL — cannot find `../src/lib/token.js`.

- [ ] **Step 3: Implement**

`apps/server/src/lib/token.ts`:
```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function verifyToken(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter server test tests/token.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the Task 3 db test (now green)**

Run: `pnpm --filter server test tests/db.test.ts`
Expected: PASS — the token module now resolves.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/lib/token.ts apps/server/tests/token.test.ts
git commit -m "feat(server): cli token hashing"
```

---

## Task 6: In-memory leaderboard store

**Files:**
- Create: `apps/server/src/lib/leaderboard-store.ts`
- Test: `apps/server/tests/leaderboard-store.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/tests/leaderboard-store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";

const base = { avatarUrl: "", xHandle: null, tier: "Iron", cardScene: "fujiNight" };

describe("LeaderboardStore", () => {
  it("ranks by the selected board and finds a user's rank", () => {
    const s = new LeaderboardStore();
    s.upsert({ id: "a", githubLogin: "a", cost30d: 100, costAllTime: 100, ...base });
    s.upsert({ id: "b", githubLogin: "b", cost30d: 300, costAllTime: 50, ...base });
    s.upsert({ id: "c", githubLogin: "c", cost30d: 200, costAllTime: 900, ...base });

    const top30 = s.getTop("30d", 10);
    expect(top30.map((e) => e.githubLogin)).toEqual(["b", "c", "a"]);

    const topAll = s.getTop("allTime", 10);
    expect(topAll.map((e) => e.githubLogin)).toEqual(["c", "a", "b"]);

    expect(s.getRank("allTime", "a")).toBe(2);
    expect(s.count()).toBe(3);
  });

  it("upsert replaces existing entries and respects the limit", () => {
    const s = new LeaderboardStore();
    s.upsert({ id: "a", githubLogin: "a", cost30d: 10, costAllTime: 10, ...base });
    s.upsert({ id: "a", githubLogin: "a", cost30d: 999, costAllTime: 999, ...base });
    expect(s.count()).toBe(1);
    expect(s.getTop("30d", 1)[0]?.cost30d).toBe(999);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter server test tests/leaderboard-store.test.ts`
Expected: FAIL — cannot find `../src/lib/leaderboard-store.js`.

- [ ] **Step 3: Implement**

`apps/server/src/lib/leaderboard-store.ts`:
```ts
export type Board = "30d" | "allTime";

export interface Entry {
  id: string;
  githubLogin: string;
  avatarUrl: string;
  xHandle: string | null;
  tier: string;
  cardScene: string;
  cost30d: number;
  costAllTime: number;
}

const metric = (e: Entry, b: Board) => (b === "30d" ? e.cost30d : e.costAllTime);

export class LeaderboardStore {
  private entries = new Map<string, Entry>();

  upsert(e: Entry): void {
    this.entries.set(e.id, e);
  }

  count(): number {
    return this.entries.size;
  }

  private sorted(board: Board): Entry[] {
    return [...this.entries.values()].sort((a, b) => metric(b, board) - metric(a, board));
  }

  getTop(board: Board, limit: number): Entry[] {
    return this.sorted(board).slice(0, limit);
  }

  getRank(board: Board, id: string): number | null {
    const idx = this.sorted(board).findIndex((e) => e.id === id);
    return idx === -1 ? null : idx + 1;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter server test tests/leaderboard-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/leaderboard-store.ts apps/server/tests/leaderboard-store.test.ts
git commit -m "feat(server): in-memory leaderboard store"
```

---

## Task 7: Ingest service

**Files:**
- Create: `apps/server/src/services/ingest.ts`
- Test: `apps/server/tests/ingest.test.ts`

Constants used here and reused by the route in Task 8: `MIN_SYNC_INTERVAL_MS = 60_000`, `SANITY_CAP = 1_000_000`.

- [ ] **Step 1: Write the failing test**

`apps/server/tests/ingest.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeDb, seedUser } from "./helpers/db.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { ingestUsage } from "../src/services/ingest.js";

async function setup() {
  const db = await makeDb();
  const store = new LeaderboardStore();
  const user = await seedUser(db, { login: "manu", token: "tok-123" });
  return { db, store, user };
}

describe("ingestUsage", () => {
  it("rejects an unknown token", async () => {
    const { db, store } = await setup();
    const res = await ingestUsage(db, store, "nope", { cost30d: 1, costAllTime: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("unauthorized");
  });

  it("persists, updates tier, store, and returns rank", async () => {
    const { db, store } = await setup();
    const res = await ingestUsage(db, store, "tok-123", { cost30d: 800, costAllTime: 2500 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tier).toBe("Diamond"); // by all-time 2500
      expect(res.rank30d).toBe(1);
      expect(store.count()).toBe(1);
    }
  });

  it("rejects values over the sanity cap", async () => {
    const { db, store } = await setup();
    const res = await ingestUsage(db, store, "tok-123", { cost30d: 1, costAllTime: 9_999_999 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("implausible");
  });

  it("rate-limits a too-soon second sync", async () => {
    const { db, store } = await setup();
    await ingestUsage(db, store, "tok-123", { cost30d: 1, costAllTime: 1 });
    const res = await ingestUsage(db, store, "tok-123", { cost30d: 2, costAllTime: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("rate_limited");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter server test tests/ingest.test.ts`
Expected: FAIL — cannot find `../src/services/ingest.js`.

- [ ] **Step 3: Implement**

`apps/server/src/services/ingest.ts`:
```ts
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users, snapshots } from "../db/schema.js";
import { hashToken } from "../lib/token.js";
import { computeTier } from "../lib/tier.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";

export const MIN_SYNC_INTERVAL_MS = 60_000;
export const SANITY_CAP = 1_000_000;

export interface IngestPayload {
  cost30d: number;
  costAllTime: number;
  ccusageVersion?: string;
}

export type IngestResult =
  | { ok: true; tier: string; rank30d: number | null; rankAllTime: number | null }
  | { ok: false; error: "unauthorized" | "implausible" | "rate_limited" };

export async function ingestUsage(
  db: DB,
  store: LeaderboardStore,
  token: string,
  payload: IngestPayload,
  now: number = Date.now(),
): Promise<IngestResult> {
  const [user] = await db.select().from(users).where(eq(users.cliTokenHash, hashToken(token)));
  if (!user) return { ok: false, error: "unauthorized" };

  if (payload.cost30d > SANITY_CAP || payload.costAllTime > SANITY_CAP) {
    return { ok: false, error: "implausible" };
  }
  if (user.lastSyncedAt && now - user.lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
    return { ok: false, error: "rate_limited" };
  }

  const tier = computeTier(payload.costAllTime);
  const syncedAt = new Date(now);

  await db
    .update(users)
    .set({
      cost30d: String(payload.cost30d),
      costAllTime: String(payload.costAllTime),
      tier,
      lastSyncedAt: syncedAt,
    })
    .where(eq(users.id, user.id));

  await db.insert(snapshots).values({
    userId: user.id,
    cost30d: String(payload.cost30d),
    costAllTime: String(payload.costAllTime),
    ccusageVersion: payload.ccusageVersion ?? "",
  });

  store.upsert({
    id: user.id,
    githubLogin: user.githubLogin,
    avatarUrl: user.avatarUrl,
    xHandle: user.xHandle,
    tier,
    cardScene: user.cardScene,
    cost30d: payload.cost30d,
    costAllTime: payload.costAllTime,
  });

  return {
    ok: true,
    tier,
    rank30d: store.getRank("30d", user.id),
    rankAllTime: store.getRank("allTime", user.id),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter server test tests/ingest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/services/ingest.ts apps/server/tests/ingest.test.ts
git commit -m "feat(server): ingest service with tier, rate limit, sanity cap"
```

---

## Task 8: Wire app dependencies + POST /ingest + GET /leaderboard

**Files:**
- Modify: `apps/server/src/app.ts`
- Create: `apps/server/src/routes/ingest.ts`
- Create: `apps/server/src/routes/leaderboard.ts`
- Modify: `apps/server/tests/routes.test.ts`

- [ ] **Step 1: Write the failing route tests**

Replace `apps/server/tests/routes.test.ts` with:
```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";

async function appWithUser() {
  const db = await makeDb();
  const store = new LeaderboardStore();
  await seedUser(db, { login: "manu", token: "tok-123" });
  const app = createApp({ db, store, onIngest: () => {} });
  return { app, store };
}

describe("routes", () => {
  it("GET /health returns ok", async () => {
    const { app } = await appWithUser();
    const res = await app.request("/health");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("POST /ingest with a bad token is 401", async () => {
    const { app } = await appWithUser();
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { authorization: "Bearer nope", "content-type": "application/json" },
      body: JSON.stringify({ cost30d: 1, costAllTime: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /ingest succeeds and GET /leaderboard returns the entry", async () => {
    const { app } = await appWithUser();
    const ingest = await app.request("/ingest", {
      method: "POST",
      headers: { authorization: "Bearer tok-123", "content-type": "application/json" },
      body: JSON.stringify({ cost30d: 800, costAllTime: 2500 }),
    });
    expect(ingest.status).toBe(200);
    const body = await ingest.json();
    expect(body.tier).toBe("Diamond");

    const lb = await app.request("/leaderboard?board=30d&limit=10");
    const data = await lb.json();
    expect(data.count).toBe(1);
    expect(data.entries[0].githubLogin).toBe("manu");
  });

  it("POST /ingest with invalid body is 400", async () => {
    const { app } = await appWithUser();
    const res = await app.request("/ingest", {
      method: "POST",
      headers: { authorization: "Bearer tok-123", "content-type": "application/json" },
      body: JSON.stringify({ cost30d: "lots" }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter server test tests/routes.test.ts`
Expected: FAIL — `createApp` takes no args / routes missing.

- [ ] **Step 3: Implement the ingest route**

`apps/server/src/routes/ingest.ts`:
```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { DB } from "../db/index.js";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";
import { ingestUsage } from "../services/ingest.js";

const bodySchema = z.object({
  cost30d: z.number().nonnegative(),
  costAllTime: z.number().nonnegative(),
  ccusageVersion: z.string().optional(),
});

export function ingestRoute(db: DB, store: LeaderboardStore, onIngest: () => void) {
  const app = new Hono();
  app.post("/", zValidator("json", bodySchema), async (c) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const res = await ingestUsage(db, store, token, c.req.valid("json"));
    if (!res.ok) {
      const status = res.error === "unauthorized" ? 401 : res.error === "rate_limited" ? 429 : 422;
      return c.json({ error: res.error }, status);
    }
    onIngest();
    return c.json(res);
  });
  return app;
}
```

- [ ] **Step 4: Implement the leaderboard route**

`apps/server/src/routes/leaderboard.ts`:
```ts
import { Hono } from "hono";
import type { LeaderboardStore, Board } from "../lib/leaderboard-store.js";

export function leaderboardRoute(store: LeaderboardStore) {
  const app = new Hono();
  app.get("/", (c) => {
    const board = (c.req.query("board") === "allTime" ? "allTime" : "30d") as Board;
    const limit = Math.min(Number(c.req.query("limit") ?? 30), 100);
    return c.json({ board, count: store.count(), entries: store.getTop(board, limit) });
  });
  return app;
}
```

- [ ] **Step 5: Update the app factory to inject deps and mount routes**

Replace `apps/server/src/app.ts` with:
```ts
import { Hono } from "hono";
import type { DB } from "./db/index.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { ingestRoute } from "./routes/ingest.js";
import { leaderboardRoute } from "./routes/leaderboard.js";

export interface AppDeps {
  db: DB;
  store: LeaderboardStore;
  onIngest: () => void;
}

export function createApp(deps?: AppDeps) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  if (deps) {
    app.route("/ingest", ingestRoute(deps.db, deps.store, deps.onIngest));
    app.route("/leaderboard", leaderboardRoute(deps.store));
  }
  return app;
}
```

- [ ] **Step 6: Run the route tests**

Run: `pnpm --filter server test tests/routes.test.ts`
Expected: PASS (4 tests). The `db` type from PGlite is structurally compatible with `DB`; if TypeScript complains in tests, the test helper return type is acceptable because both share the same `schema`.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `pnpm --filter server test && pnpm --filter server typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/app.ts apps/server/src/routes apps/server/tests/routes.test.ts
git commit -m "feat(server): ingest and leaderboard routes with DI app factory"
```

---

## Task 9: WebSocket broadcast

**Files:**
- Create: `apps/server/src/ws/broadcast.ts`
- Test: `apps/server/tests/ws.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/server/tests/ws.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { attachBroadcast } from "../src/ws/broadcast.js";

let cleanup: (() => void) | null = null;
afterEach(() => cleanup?.());

const base = { avatarUrl: "", xHandle: null, tier: "Iron", cardScene: "fujiNight" };

function startServer(store: LeaderboardStore) {
  const http = createServer();
  const wss = new WebSocketServer({ server: http });
  const broadcast = attachBroadcast(wss, store, { debounceMs: 5 });
  return new Promise<{ port: number; broadcast: () => void }>((resolve) => {
    http.listen(0, () => {
      const port = (http.address() as any).port;
      cleanup = () => { wss.close(); http.close(); };
      resolve({ port, broadcast });
    });
  });
}

function once(ws: WebSocket): Promise<any> {
  return new Promise((res) => ws.once("message", (d) => res(JSON.parse(d.toString()))));
}

describe("attachBroadcast", () => {
  it("sends a snapshot on connect", async () => {
    const store = new LeaderboardStore();
    store.upsert({ id: "a", githubLogin: "a", cost30d: 10, costAllTime: 10, ...base });
    const { port } = await startServer(store);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msg = await once(ws);
    expect(msg.type).toBe("snapshot");
    expect(msg.top30d[0].githubLogin).toBe("a");
    ws.close();
  });

  it("pushes an update when broadcast() is called", async () => {
    const store = new LeaderboardStore();
    const { port, broadcast } = await startServer(store);
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(ws); // initial snapshot
    store.upsert({ id: "b", githubLogin: "b", cost30d: 99, costAllTime: 99, ...base });
    broadcast();
    const msg = await once(ws);
    expect(msg.type).toBe("update");
    expect(msg.top30d[0].githubLogin).toBe("b");
    ws.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter server test tests/ws.test.ts`
Expected: FAIL — cannot find `../src/ws/broadcast.js`.

- [ ] **Step 3: Implement**

`apps/server/src/ws/broadcast.ts`:
```ts
import type { WebSocketServer } from "ws";
import type { LeaderboardStore } from "../lib/leaderboard-store.js";

const TOP_N = 100;

function payload(store: LeaderboardStore, type: "snapshot" | "update") {
  return JSON.stringify({
    type,
    count: store.count(),
    top30d: store.getTop("30d", TOP_N),
    topAllTime: store.getTop("allTime", TOP_N),
  });
}

export function attachBroadcast(
  wss: WebSocketServer,
  store: LeaderboardStore,
  opts: { debounceMs?: number } = {},
) {
  const debounceMs = opts.debounceMs ?? 1000;

  wss.on("connection", (ws) => {
    ws.send(payload(store, "snapshot"));
  });

  let timer: NodeJS.Timeout | null = null;
  return function broadcast() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const msg = payload(store, "update");
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(msg);
      }
    }, debounceMs);
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter server test tests/ws.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ws/broadcast.ts apps/server/tests/ws.test.ts
git commit -m "feat(server): websocket snapshot + debounced broadcast"
```

---

## Task 10: Config + entrypoint

**Files:**
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/index.ts`
- Test: `apps/server/tests/config.test.ts`

- [ ] **Step 1: Write the failing config test**

`apps/server/tests/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("parses valid env", () => {
    const cfg = parseConfig({ DATABASE_URL: "postgres://x", PORT: "4000" });
    expect(cfg.databaseUrl).toBe("postgres://x");
    expect(cfg.port).toBe(4000);
  });
  it("defaults the port", () => {
    const cfg = parseConfig({ DATABASE_URL: "postgres://x" });
    expect(cfg.port).toBe(8080);
  });
  it("throws when DATABASE_URL is missing", () => {
    expect(() => parseConfig({})).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter server test tests/config.test.ts`
Expected: FAIL — cannot find `../src/config.js`.

- [ ] **Step 3: Implement config**

`apps/server/src/config.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(8080),
});

export interface Config {
  databaseUrl: string;
  port: number;
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.parse(env);
  return { databaseUrl: parsed.DATABASE_URL, port: parsed.PORT };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter server test tests/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the entrypoint (manually verified, not unit-tested)**

`apps/server/src/index.ts`:
```ts
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { eq } from "drizzle-orm";
import { parseConfig } from "./config.js";
import { createDb } from "./db/index.js";
import { users } from "./db/schema.js";
import { LeaderboardStore } from "./lib/leaderboard-store.js";
import { createApp } from "./app.js";
import { attachBroadcast } from "./ws/broadcast.js";

const cfg = parseConfig(process.env);
const db = createDb(cfg.databaseUrl);
const store = new LeaderboardStore();

// Warm the store from Postgres on boot.
const rows = await db.select().from(users);
for (const u of rows) {
  store.upsert({
    id: u.id,
    githubLogin: u.githubLogin,
    avatarUrl: u.avatarUrl,
    xHandle: u.xHandle,
    tier: u.tier,
    cardScene: u.cardScene,
    cost30d: Number(u.cost30d),
    costAllTime: Number(u.costAllTime),
  });
}

const wss = new WebSocketServer({ noServer: true });
const broadcast = attachBroadcast(wss, store);
const app = createApp({ db, store, onIngest: broadcast });

const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`ccwarriors server on :${info.port}`);
});

server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket as any, head, (ws) => wss.emit("connection", ws, req));
});

void eq; // referenced for future queries; keep import tree-shake-safe
```

- [ ] **Step 6: Build to confirm the entrypoint compiles**

Run: `pnpm --filter server build`
Expected: `tsc` completes with no errors, emits `apps/server/dist/`.

- [ ] **Step 7: Add dist to gitignore and commit**

Append to `.gitignore`:
```
node_modules/
dist/
```

```bash
git add apps/server/src/config.ts apps/server/src/index.ts apps/server/tests/config.test.ts .gitignore
git commit -m "feat(server): config parsing and server entrypoint"
```

---

## Task 11: Full green + CI script

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Run the whole suite, typecheck, and build**

Run: `pnpm install && pnpm -r test && pnpm -r typecheck && pnpm -r build`
Expected: all server tests PASS, typecheck clean, build emits dist.

- [ ] **Step 2: Add a convenience verify script**

In root `package.json`, add to `scripts`:
```json
"verify": "pnpm -r test && pnpm -r typecheck && pnpm -r build"
```

- [ ] **Step 3: Run it**

Run: `pnpm verify`
Expected: PASS end-to-end.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add verify script"
```

---

## Self-Review Notes (resolved during authoring)

- **Spec coverage (backend portion):** schema (§6) → Task 3; tiers (§12) → Task 4; CLI token auth for ingest (§7/§8) → Tasks 5, 7, 8; live leaderboard + WS (§9) → Tasks 6, 8, 9; rate limit + sanity cap anti-cheat (§14) → Task 7; config/deploy boot (§15) → Task 10. Card generation, OAuth, CLI, and frontend are explicitly **out of scope** for this plan (Plans 2–4).
- **Type consistency:** `ingestUsage(db, store, token, payload)`, `LeaderboardStore.{upsert,getTop,getRank,count}`, `createApp(deps)`, `attachBroadcast(wss, store, opts)` are used identically across tasks. The `Entry` shape (Task 6) matches the object built in `ingestUsage` (Task 7) and the `seedUser`/warm-up loops.
- **Placeholders:** none — every step has runnable code/commands.
- **Open follow-ups for Plan 2:** the `users` row needs an OAuth-driven creation path + token issuance (here tests seed it); `cardScene` assignment (rarer scenes for higher tiers) lives with card generation.
