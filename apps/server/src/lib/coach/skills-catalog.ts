// skills.sh Tier-A — turn a recommended skill NAME into an honest, runnable
// discovery command. We intentionally emit `npx skills find <name>` (discovery)
// rather than `npx skills add <owner/repo>`: the skills.sh registry API is
// auth-gated (Vercel OIDC), so the exact canonical id can't be verified here, and
// we will not ship a guessed/fabricated id. `npx skills find` surfaces matching
// skills across skills.sh so the user can pick and install. A future task with a
// verified curated snapshot can upgrade find -> add.
export function resolveInstallTarget(skillName: string): { skillId: string; command: string } | null {
  const q = skillName.trim();
  if (!q) return null;
  return { skillId: q, command: `npx skills find ${q}` };
}
