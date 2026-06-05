import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  jsonb,
  boolean,
  bigint,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
  // Multi-tool (all nullable/defaulted — additive, legacy rows stay valid):
  toolBreakdown: jsonb("tool_breakdown").$type<ToolBreakdown>(),
  clientBuildId: text("client_build_id"),
  hasBreakdown: boolean("has_breakdown").notNull().default(false),
  // Anti-gaming shadow quarantine: flagged users keep syncing but leave the boards.
  flaggedAt: timestamp("flagged_at", { withTimezone: true }),
  flagReason: text("flag_reason"),
});

export const snapshots = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  cost30d: numeric("cost_30d").notNull(),
  costAllTime: numeric("cost_all_time").notNull(),
  ccusageVersion: text("ccusage_version").notNull().default(""),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  toolBreakdown: jsonb("tool_breakdown").$type<ToolBreakdown>(),
  clientBuildId: text("client_build_id"),
});

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UsageDay = typeof usageDays.$inferSelect;
export type Donation = typeof donations.$inferSelect;
