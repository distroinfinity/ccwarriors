// The daemon got a 401. If a newer token is on disk (the user re-logged-in
// elsewhere) we adopt it and resume; otherwise the token is genuinely expired
// and we pause until a re-login lands.
export function resolveAuthAction(currentToken: string, diskToken: string | null): "resume" | "pause" {
  return diskToken && diskToken !== currentToken ? "resume" : "pause";
}
