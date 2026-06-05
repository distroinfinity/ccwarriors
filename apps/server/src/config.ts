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
  // Base URL this server is reachable at (used to build the GitHub redirect_uri).
  PUBLIC_BASE_URL: z.string().default("http://localhost:8787"),
  // Base URL of the web frontend (for any future cross-origin redirects).
  WEB_BASE_URL: z.string().default("http://localhost:5173"),
});

export interface Config {
  databaseUrl?: string;
  port: number;
  seedDemo: boolean;
  simulate: boolean;
  corsOrigin: string;
  githubClientId?: string;
  githubClientSecret?: string;
  publicBaseUrl: string;
  webBaseUrl: string;
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
    publicBaseUrl: p.PUBLIC_BASE_URL,
    webBaseUrl: p.WEB_BASE_URL,
  };
}
