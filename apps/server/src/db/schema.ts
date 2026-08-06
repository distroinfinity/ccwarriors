import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  jsonb,
  boolean,
  bigint,
  integer,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Per-tool served aggregate, server-computed. Null on rows written by legacy
// (claude-only) clients — derived as { claude: totals } at read time.
export type ToolBreakdown = Record<string, { cost30d: number; costAllTime: number }>;

// Per-model token counts inside a usage day (raw ground truth from the client).
export type ModelTokens = {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

// Hashed per-session git outcome (mirrors packages/cli/src/git.ts
// SessionGitOutcome exactly). Numbers, booleans, and salted sha256 hex only —
// no code, diffs, paths, commit messages, or SHAs ever reach the server.
export type SessionGitOutcome = {
  repoIdHash: string;
  branchHash: string;
  commitsInWindow: number;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
  testFilesTouched: number;
  aiLinkedCommits: number;
  revertedLinesWithin14d: number;
  squashMergeDetected: boolean;
  rebaseDetected: boolean;
  isMonorepo: boolean;
  hasRemote: boolean;
  // Commit-timing histograms (24 hours, 7 days-of-week), machine-local. Optional:
  // older clients (pre-timing-upgrade) omit them, so consumers must guard.
  commitHours?: number[]; // 24 buckets, hour-of-day commit counts
  commitDows?: number[]; // 7 buckets, day-of-week commit counts (0 = Sunday)
  // fix/feature/refactor/other counts from commit subjects (counts only;
  // optional — older clients omit).
  commitKinds?: { fixes: number; features: number; refactors: number; other: number };
};

// One uploadable per-session record (mirrors packages/cli/src/insights.ts
// SessionRecord exactly). Deep mode uploads an array of these; the server
// derives the aggregate InsightsPayload from them.
export type SessionRecord = {
  startHour: number;
  durationMinutes: number;
  prompts: number;
  interrupts: number;
  usedPlanMode: boolean;
  exploreBeforeFirstEdit: boolean;
  hadEdits: boolean;
  subagentSpawns: number;
  maxParallel: number;
  editCalls: number;
  assistantTurns: number;
  wordBuckets: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
  model: string | null;
  timing: { events: number; medianGapMs: number; p10GapMs: number; subSecondFraction: number };
  git: SessionGitOutcome | null;
  // New deep signals — optional: older clients omit them.
  thankYous?: number;
  wordTotal?: number;
  recovery?: { loops: number; medianBreakoutMs: number };
  extensions?: Record<string, number>;
};

// The deep payload the client sends (mirrors packages/cli/src/insights.ts
// InsightsDeepPayload exactly). New fields optional for older clients.
export type InsightsDeepPayload = {
  windowDays: number;
  sessions: SessionRecord[];
  maxConcurrentSessions?: number;
  // The only TEXT field — present only under consent v2, redacted client-side.
  topPrompt?: { text: string; count: number; sessions: number } | null;
};

// Aggregate behavioral counts extracted locally by the CLI from session JSONL.
// Raw counts and histograms only — prompt text, paths, code never leave the machine.
export type InsightsPayload = {
  windowDays: number;
  sessions: number;
  promptWordHistogram: { "1-5": number; "6-10": number; "11-25": number; "26+": number };
  planModeSessionsPct: number; // % of sessions that used plan mode
  exploreBeforeEditRatio: number; // sessions with explore call before first edit / sessions with edits
  avgTurnsBetweenUserMsgs: number;
  interruptsPer100Turns: number;
  subagentSpawnsPerSession: number;
  maxParallelAgents: number;
  hourHistogram: number[]; // 24 buckets, session-start counts, machine-local
  editToolCallsPerSession: number;
  longestSessionMinutes: number;
};

export const users = pgTable(
  "users",
  {
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
  // Multi-tool (all nullable/defaulted — additive, legacy rows stay valid):
  toolBreakdown: jsonb("tool_breakdown").$type<ToolBreakdown>(),
  clientBuildId: text("client_build_id"),
  hasBreakdown: boolean("has_breakdown").notNull().default(false),
  // Anti-gaming shadow quarantine: flagged users keep syncing but leave the boards.
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  flagReason: text("flag_reason"),
  // Channel attribution (?ref=hn → install → enlist). First touch, never updated.
  installSource: text("install_source"),
  // Warrior profile insights (behavioral extraction). Consent is the source of
  // truth: the CLI only extracts while this is true, and /insights rejects
  // payloads when it is false (stale clients can't push post-revoke).
  insightsConsent: boolean("insights_consent").notNull().default(false),
  // Binary off/deep mode (forward-compatible with a future 'transcript').
  // mode !== 'off' is the source of truth; insightsConsent is kept consistent
  // (consent = mode === 'deep') so #47 code reading the boolean still works.
  insightsMode: text("insights_mode").notNull().default("off"), // off | deep
  insightsVisibility: text("insights_visibility").notNull().default("public"), // public | private
  archetype: text("archetype"),
  // Craft Score (issue #51): the headline composite, recomputed eagerly on each
  // /insights/deep upload so the leaderboard/ranking can read it without
  // replaying the pillar math. Null when mode is off or there's no deep data.
  craftScore: numeric("craft_score"),
  trustTier: integer("trust_tier"), // 0 unverified | 1 local-git
  // GitHub OAuth access token, persisted at login for server-side PUBLIC-data
  // reads (5000 req/h/token). Scope is read:user only — blast radius of a leak
  // is rate-limit theft, not data access. Nulled on a 401 (revoked).
  githubAccessToken: text("github_access_token"),
  // Deep-mode disclosure version the user last acknowledged. The CLI shows a
  // one-time notice when the server's CONSENT_VERSION is newer (deep scope
  // expanded — e.g. v2 added prompt-text extracts + redacted transcripts).
  // Null = consented before versioning existed (treated as v1).
  consentVersion: integer("consent_version"),
  // Owner-curated deck order: up to 4 card keys pinned to the front.
  pinnedCards: jsonb("pinned_cards").$type<string[]>(),
  },
  (t) => [
    // Every authenticated CLI request resolves its bearer token through this
    // column — without the index that was a seq scan per sync.
    index("users_cli_token_hash").on(t.cliTokenHash),
    // Profile/OG/badge routes look users up by lower(github_login).
    index("users_github_login_lower").on(sql`lower(${t.githubLogin})`),
  ],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    cost30d: numeric("cost_30d").notNull(),
    costAllTime: numeric("cost_all_time").notNull(),
    ccusageVersion: text("ccusage_version").notNull().default(""),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    toolBreakdown: jsonb("tool_breakdown").$type<ToolBreakdown>(),
    clientBuildId: text("client_build_id"),
  },
  (t) => [
    // Serves the stale-daemons 7-day join and the retention pruner's
    // captured_at range scans (see services/retention.ts).
    index("snapshots_user_captured").on(t.userId, t.capturedAt),
    index("snapshots_captured_at").on(t.capturedAt),
  ],
);

// Raw per-user/tool/day usage — what the server prices and audits.
// Costs are server-computed from token counts; client dollars are never trusted.
export const usageDays = pgTable(
  "usage_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // One row per machine: multi-machine users aggregate by sum instead of
    // last-write-wins flip-flopping (which would also false-trip the
    // history-immutability gate). Empty string = unidentified client.
    machineId: text("machine_id").notNull().default(""),
    tool: text("tool").notNull(),
    day: date("day").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheCreationTokens: bigint("cache_creation_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    modelBreakdown: jsonb("model_breakdown").$type<ModelTokens[]>(),
    cost: numeric("cost").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("usage_days_user_machine_tool_day").on(t.userId, t.machineId, t.tool, t.day)],
);

// Sponsor donations (Razorpay web checkout). Amounts in whole rupees —
// paise conversion happens only at the Razorpay API boundary.
export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("razorpay"),
  razorpayOrderId: text("razorpay_order_id").notNull().unique(),
  razorpayPaymentId: text("razorpay_payment_id"),
  name: text("name"),
  amount: numeric("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: text("status").notNull().default("created"), // created | paid
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Verified org memberships (e.g. Network School). The org itself lives in the
// code registry (lib/orgs.ts) keyed by slug — only membership is data.
export const orgMembers = pgTable(
  "org_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    orgSlug: text("org_slug").notNull(),
    discordUserId: text("discord_user_id").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("org_members_user_org").on(t.userId, t.orgSlug)],
);

// Per-machine behavioral insights payload (aggregate counts only — no
// transcript text ever reaches the server). Mirrors usage_days conventions:
// one row per (user, machine), updated in place each send.
export const userInsights = pgTable(
  "user_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    machineId: text("machine_id").notNull(),
    payload: jsonb("payload").$type<InsightsPayload>().notNull(),
    windowDays: bigint("window_days", { mode: "number" }).notNull().default(40),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_insights_user_machine").on(t.userId, t.machineId)],
);

// Deep-mode per-session records (Craft Score). One row per (user, machine),
// updated in place each send. Mirrors user_insights conventions. The server
// derives the aggregate user_insights row from these on every upload.
export const userDeepSessions = pgTable(
  "user_deep_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    machineId: text("machine_id").notNull(),
    sessions: jsonb("sessions").$type<SessionRecord[]>().notNull(),
    windowDays: bigint("window_days", { mode: "number" }).notNull().default(40),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    // Payload-level signals that aren't per-session (older clients omit).
    extras: jsonb("extras").$type<{
      maxConcurrentSessions?: number;
      topPrompt?: { text: string; count: number; sessions: number } | null;
    }>(),
  },
  (t) => [uniqueIndex("user_deep_sessions_user_machine").on(t.userId, t.machineId)],
);

// ── GitHub public stats (issue #48, public-only subset) ─────────────────────
// Verified-by-GitHub public footprint, fetched server-side with the user's own
// OAuth token (or a server PAT fallback). Card doctrine applies downstream:
// a missing block means "no data", never fabricated zeros.
export type GithubStats = {
  login: string;
  accountCreatedAt: string; // ISO
  followers: number;
  publicRepos: number;
  totalStars: number; // sum over top-100 owned public repos by stars
  topLanguages: Array<{ name: string; repos: number }>; // primaryLanguage, top 5
  mergedPublicPrs: number;
  reviewsLastYear: number;
  commitsLastYear: number;
  contributionsLastYear: number;
  currentStreakDays: number;
  longestStreakDays: number;
  reposContributedTo: number; // repos the user doesn't own
  windowCommits: number; // commit contributions in the last 40 days
  windowPrs?: number; // PR contributions in the last 40 days (absent on pre-#55 rows)
};

// One row per user, upserted by the background refresher. `data` survives
// later failed fetches (serve-stale-forever); `status` + `fetchedAt` drive
// the retry backoff.
export const githubStats = pgTable(
  "github_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().default("ok"), // ok | error
    data: jsonb("data").$type<GithubStats>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("github_stats_user").on(t.userId)],
);

// ── Story (issue #50: transcript-LLM narrative) ──────────────────────────────
// The derived narrative document. Raw transcripts are processed then PURGED —
// only this derived doc persists (the documented promise).
export type StoryDoc = {
  tagline?: string; // one sentence on who they are (optional: old rows predate it)
  narrative: string; // the headline paragraph (now person-first)
  arc?: string; // how they changed across the window (optional; may be "")
  whatYouBuilt: string;
  decisionPatterns: Array<{ name: string; count: number; evidence: string }>;
  strengths: Array<{ title: string; detail: string }>;
  growthAreas: Array<{ title: string; detail: string }>;
  aiArchetypes: Array<{ name: string; blurb: string; evidence: number }>;
  crypticPrompt: string | null; // most cryptic prompt, LLM-picked (already redacted client-side)
  sessionsAnalyzed: number; // server-stamped from sessionsUsed — never trusted from LLM
  windowDays?: number; // server-stamped from source payload (jsonb — no migration needed)
};

export const userStories = pgTable(
  "user_stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    doc: jsonb("doc").$type<StoryDoc>().notNull(),
    model: text("model").notNull().default(""),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_stories_user").on(t.userId)],
);

// Transient transcript payloads awaiting story generation. Rows are DELETED
// after the story is generated (or after TTL) — never retained.
export const storySources = pgTable(
  "story_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    payload: jsonb("payload").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("story_sources_user").on(t.userId)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UsageDay = typeof usageDays.$inferSelect;
export type Donation = typeof donations.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type UserInsights = typeof userInsights.$inferSelect;
export type UserDeepSessions = typeof userDeepSessions.$inferSelect;
