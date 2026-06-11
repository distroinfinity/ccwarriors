import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  // Postgres connection. Optional: when unset we fall back to in-memory PGlite
  // (great for local dev and a zero-setup demo).
  DATABASE_URL: z.string().optional(),
  // 8787 is the documented local default (web falls back to ws://localhost:8787).
  // Worktrees override via .env PORT (written by .superset/setup.sh); prod
  // platforms set PORT explicitly.
  PORT: z.coerce.number().default(8787),
  // Seed the board with demo warriors + simulate live spend (the dummy-data demo).
  SEED_DEMO: bool,
  SIMULATE: bool,
  // Allowed browser origins for the public API. "*" or comma-separated list.
  CORS_ORIGIN: z.string().default("*"),
  // GitHub OAuth app credentials (optional — OAuth is disabled when unset).
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  // Server-owned PAT for public GitHub-stats reads (optional) — the fallback
  // for users whose OAuth token isn't stored yet (pre-#48 logins) or revoked.
  GITHUB_TOKEN: z.string().optional(),
  // Claude API key for story generation (#50). Absent → story features dormant.
  ANTHROPIC_API_KEY: z.string().optional(),
  STORY_MODEL: z.string().optional(),
  // Discord OAuth app credentials (optional — org verification is disabled
  // when unset). Per-org guild IDs come from their own env vars (NS_GUILD_ID).
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  // Base URL this server is reachable at (used to build the GitHub redirect_uri).
  PUBLIC_BASE_URL: z.string().default("http://localhost:8787"),
  // Base URL of the web frontend (for any future cross-origin redirects).
  WEB_BASE_URL: z.string().default("http://localhost:5173"),
  // Razorpay checkout keys (optional — donations are disabled when unset).
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // Webhook secret (optional — set when the payment.captured webhook exists).
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

export interface Config {
  databaseUrl?: string;
  port: number;
  seedDemo: boolean;
  simulate: boolean;
  corsOrigin: string;
  githubClientId?: string;
  githubClientSecret?: string;
  githubToken?: string;
  anthropicApiKey?: string;
  storyModel?: string;
  discordClientId?: string;
  discordClientSecret?: string;
  publicBaseUrl: string;
  webBaseUrl: string;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
}

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const p = schema.parse(env);
  return {
    databaseUrl: p.DATABASE_URL && p.DATABASE_URL.length > 0 ? p.DATABASE_URL : undefined,
    port: p.PORT,
    seedDemo: p.SEED_DEMO,
    simulate: p.SIMULATE,
    corsOrigin: p.CORS_ORIGIN,
    githubClientId: p.GITHUB_CLIENT_ID && p.GITHUB_CLIENT_ID.length > 0 ? p.GITHUB_CLIENT_ID : undefined,
    githubClientSecret: p.GITHUB_CLIENT_SECRET && p.GITHUB_CLIENT_SECRET.length > 0 ? p.GITHUB_CLIENT_SECRET : undefined,
    githubToken: p.GITHUB_TOKEN && p.GITHUB_TOKEN.length > 0 ? p.GITHUB_TOKEN : undefined,
    anthropicApiKey: p.ANTHROPIC_API_KEY && p.ANTHROPIC_API_KEY.length > 0 ? p.ANTHROPIC_API_KEY : undefined,
    storyModel: p.STORY_MODEL && p.STORY_MODEL.length > 0 ? p.STORY_MODEL : undefined,
    discordClientId: p.DISCORD_CLIENT_ID && p.DISCORD_CLIENT_ID.length > 0 ? p.DISCORD_CLIENT_ID : undefined,
    discordClientSecret: p.DISCORD_CLIENT_SECRET && p.DISCORD_CLIENT_SECRET.length > 0 ? p.DISCORD_CLIENT_SECRET : undefined,
    publicBaseUrl: p.PUBLIC_BASE_URL,
    webBaseUrl: p.WEB_BASE_URL,
    razorpayKeyId:
      p.RAZORPAY_KEY_ID && p.RAZORPAY_KEY_ID.length > 0 ? p.RAZORPAY_KEY_ID : undefined,
    razorpayKeySecret:
      p.RAZORPAY_KEY_SECRET && p.RAZORPAY_KEY_SECRET.length > 0 ? p.RAZORPAY_KEY_SECRET : undefined,
    razorpayWebhookSecret:
      p.RAZORPAY_WEBHOOK_SECRET && p.RAZORPAY_WEBHOOK_SECRET.length > 0
        ? p.RAZORPAY_WEBHOOK_SECRET
        : undefined,
  };
}
