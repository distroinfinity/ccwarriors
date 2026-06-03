// Signed, stateless tokens (HMAC-SHA256). Used for OAuth state and session cookies.
import { createHmac } from "node:crypto";

export function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${sig}`;
}

export function verify(token: string, secret: string): Record<string, unknown> | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const SESSION_TTL_S = 90 * 24 * 3600; // 90 days

export interface Session {
  login: string;
  avatarUrl: string;
  githubId: string;
}

export function createSessionToken(s: Session, secret: string, nowMs: number = Date.now()): string {
  return sign({ ...s, exp: Math.floor(nowMs / 1000) + SESSION_TTL_S }, secret);
}

export function readSessionToken(token: string, secret: string, nowMs: number = Date.now()): Session | null {
  const p = verify(token, secret);
  if (!p) return null;
  const { login, avatarUrl, githubId, exp } = p as Partial<Session> & { exp?: number };
  if (typeof login !== "string" || typeof exp !== "number") return null;
  if (exp * 1000 < nowMs) return null;
  return { login, avatarUrl: String(avatarUrl ?? ""), githubId: String(githubId ?? "") };
}

/** Cookie attributes for the session, shared across the apex + subdomains. */
export function sessionCookie(token: string, publicBaseUrl: string, maxAgeS: number = SESSION_TTL_S): string {
  const url = new URL(publicBaseUrl);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  // api.ccwarriors.xyz → ccwarriors.xyz so the cookie is visible site-wide.
  const domain = isLocal ? "" : `; Domain=${url.hostname.split(".").slice(-2).join(".")}`;
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `ccw_session=${token}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${domain}${secure}`;
}
