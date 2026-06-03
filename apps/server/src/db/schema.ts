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
