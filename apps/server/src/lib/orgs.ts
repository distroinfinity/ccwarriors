// Org registry — server side. Branding lives in the web twin
// (apps/web/src/orgs.ts); the slug is the contract between the two.
// Guild IDs come from env (resolved at call time, never in git).

export interface OrgConfig {
  slug: string;
  name: string;
  // Env var holding the Discord server ID whose members may verify into
  // this org's board.
  guildEnv: string;
}

export const ORGS: Record<string, OrgConfig> = {
  ns: { slug: "ns", name: "Network School", guildEnv: "NS_GUILD_ID" },
};

export const orgBySlug = (slug: string): OrgConfig | undefined => ORGS[slug];

export const allOrgSlugs = (): string[] => Object.keys(ORGS);

export const guildIdFor = (org: OrgConfig): string => process.env[org.guildEnv] ?? "";
