// Client-side secret stripping. Every piece of TEXT that leaves the machine
// (topPrompt, transcripts) passes through here FIRST, on the user's machine.
// Over-redaction is the safe failure mode; patterns are deliberately greedy.

const MASK = "▮▮▮";

const PATTERNS: RegExp[] = [
  // Vendor API keys / tokens (anthropic, openai, github, stripe, slack, generic sk-)
  /sk-[A-Za-z0-9_-]{16,}/g,
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  // AWS access key ids
  /\bAKIA[A-Z0-9]{16}\b/g,
  // JWTs (three base64url segments, first starting with eyJ)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
  // URLs with embedded credentials → mask the credential part
  /\/\/[^\s/:@]+:[^\s@]+@/g,
  // KEY=value assignments where the key smells secret
  /\b[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|APIKEY|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[=:]\s*\S+/gi,
  // Long hex blobs (32+ chars) — salts, hashes, raw keys
  /\b[0-9a-fA-F]{32,}\b/g,
  // Long base64-ish blobs (40+ chars)
  /\b[A-Za-z0-9+/=_-]{48,}\b/g,
  // Email addresses
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, MASK);
  return out;
}
