// USD→INR for donations. Tiers display in dollars; Razorpay charges rupees —
// the server owns the conversion (like pricing.ts owns token prices, the
// client never gets to pick its own rate).

// Fallback until the first refresh lands (and if the FX API is ever down).
// ~June 2026 level; the live fetch corrects it within seconds of boot.
const FALLBACK_USD_INR = 95;

// ECB reference rates via frankfurter — free, keyless, no auth.
const FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR";
const REFRESH_MS = 12 * 60 * 60 * 1000; // twice a day; FX drift is slow

let usdInr = FALLBACK_USD_INR;

export function getUsdInr(): number {
  return usdInr;
}

export async function refreshFx(): Promise<void> {
  try {
    const res = await fetch(FX_URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`fx api ${res.status}`);
    const data = (await res.json()) as { rates?: { INR?: number } };
    const rate = data.rates?.INR;
    // Sanity band so a broken API response can't make donations absurd.
    if (typeof rate === "number" && rate > 40 && rate < 200) {
      usdInr = rate;
      console.log(`fx: USD→INR ${rate}`);
    }
  } catch (err) {
    console.warn("fx refresh skipped:", err instanceof Error ? err.message : err);
  }
}

export function startFxRefresh(): NodeJS.Timeout {
  void refreshFx();
  const t = setInterval(() => void refreshFx(), REFRESH_MS);
  t.unref?.();
  return t;
}
