import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  checkSettledDayGrowth,
  checkBurnRate,
  checkDailyCeiling,
  checkNewToolWindow,
  isQuarantining,
  quarantineReasons,
  totalTokens,
} from "../src/lib/plausibility.js";
import { ingestUsage, type RawIngestPayload } from "../src/services/ingest.js";
import { LeaderboardStore } from "../src/lib/leaderboard-store.js";
import { makeDb, seedUser } from "./helpers/db.js";
import { users } from "../src/db/schema.js";

// Regression cover for the incident that quarantined 31 of 77 production users:
// the gates compared DOLLARS, but dollars are recomputed from a LiteLLM table
// that changes upstream. A codex day whose tokens never moved was stored at
// $54.62, flagged as "$54.62 → $75.49", and prices to $42.90 today.

const NOW = Date.UTC(2026, 5, 4, 12, 0, 0);
const settled = new Date(NOW - 10 * 86_400_000).toISOString().slice(0, 10);

// The real distroinfinity/codex/2026-07-13 row that tripped the gate.
const REAL_DAY = [
  {
    modelName: "gpt-5.6-sol",
    inputTokens: 3_571_060,
    outputTokens: 200_492,
    cacheCreationTokens: 0,
    cacheReadTokens: 61_508_864,
  },
];

describe("price drift must never look like tampering", () => {
  it("identical tokens do not trip the settled-day gate, whatever they price at", () => {
    const tokens = totalTokens(REAL_DAY);
    // Same day, same tokens, re-ingested after a LiteLLM refresh.
    expect(checkSettledDayGrowth("codex", settled, tokens, tokens, NOW)).toBeNull();
  });

  it("a 38% cost swing on unchanged tokens is invisible to the gate", () => {
    // The exact prod numbers: $54.62 → $75.49 on the same 65.28M tokens.
    const tokens = totalTokens(REAL_DAY);
    expect(tokens).toBe(65_280_416);
    expect(checkSettledDayGrowth("codex", settled, tokens, tokens, NOW)).toBeNull();
    // …and the burn gate, which re-priced the whole 30d window at once.
    expect(checkBurnRate(tokens, tokens, new Date(NOW - 300_000), NOW)).toBeNull();
  });

  it("genuinely grown tokens on a settled day still produce the signal", () => {
    const sig = checkSettledDayGrowth("codex", settled, 1_000_000_000, 3_000_000_000, NOW);
    expect(sig?.reason).toBe("history_rewrite");
  });

  it("the ceilings are token-denominated, so a reprice cannot cross them", () => {
    // 19B tokens is under the ceiling no matter what the tokens cost today.
    expect(checkDailyCeiling("codex", settled, 19e9)).toBeNull();
    expect(checkDailyCeiling("codex", settled, 21e9)?.reason).toBe("daily_ceiling");
    expect(checkNewToolWindow("codex", 149e9)).toBeNull();
    expect(checkNewToolWindow("codex", 151e9)?.reason).toBe("new_tool_backfill");
  });
});

describe("quarantine policy", () => {
  afterEach(() => {
    delete process.env.GATE_QUARANTINE_ENABLED;
    delete process.env.GATE_QUARANTINE_REASONS;
  });

  it("the two price-sensitive gates are observation-only", () => {
    expect(isQuarantining("history_rewrite")).toBe(false);
    expect(isQuarantining("burn_rate")).toBe(false);
  });

  it("the gates a reprice cannot move still quarantine", () => {
    for (const r of ["token_shape", "sanity_cap", "machine_count", "daily_ceiling", "new_tool_backfill", "outcome_implausible", "timing_regular"]) {
      expect(isQuarantining(r)).toBe(true);
    }
  });

  it("GATE_QUARANTINE_ENABLED=0 lifts every gate without a deploy", () => {
    process.env.GATE_QUARANTINE_ENABLED = "0";
    expect(quarantineReasons().size).toBe(0);
    expect(isQuarantining("token_shape")).toBe(false);
  });

  it("GATE_QUARANTINE_REASONS replaces the set", () => {
    process.env.GATE_QUARANTINE_REASONS = "token_shape, sanity_cap";
    expect(isQuarantining("token_shape")).toBe(true);
    expect(isQuarantining("daily_ceiling")).toBe(false);
  });
});

describe("end to end: the prod row that lost distroinfinity the board", () => {
  const TOKEN = "tok_drift";
  const raw = (days: { date: string; models: typeof REAL_DAY }[]): RawIngestPayload => ({
    kind: "raw",
    tools: { codex: days },
    machineId: "15dc2fdbda324e52",
  });

  it("re-syncing the same settled day twice keeps the user ranked", async () => {
    const db = await makeDb();
    const store = new LeaderboardStore();
    await seedUser(db, { login: "distroinfinity", token: TOKEN });

    await ingestUsage(db, store, TOKEN, raw([{ date: settled, models: REAL_DAY }]), NOW);
    // The daemon re-syncs the identical day 15 minutes later. Between the two,
    // a LiteLLM refresh changed cache_read pricing — tokens are byte-identical.
    await ingestUsage(db, store, TOKEN, raw([{ date: settled, models: REAL_DAY }]), NOW + 900_000);

    const [u] = await db.select().from(users).where(eq(users.githubLogin, "distroinfinity"));
    expect(u!.flaggedAt).toBeNull();
    expect(u!.flagReason).toBeNull();
    expect(store.getTop("30d", 10)).toHaveLength(1);
  });
});
