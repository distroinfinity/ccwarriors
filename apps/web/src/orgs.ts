// Org registry — web side (branding only). The server twin
// (apps/server/src/lib/orgs.ts) holds guild IDs; the slug is the contract.

export interface WebOrg {
  slug: string;
  name: string;
  /** Org accent, applied via html[data-org] CSS overrides AND inline badge color. */
  accent: string;
  themeDefault: "dark" | "light";
  title: string;
  /** One-liner under the hero heading on the org page. */
  tagline: string;
  /** Org homepage — the header lockup links here. */
  url: string;
  /** Payment-method ordering in the sponsor section. Default: card/UPI first. */
  payments?: "crypto-first";
}

export const WEB_ORGS: Record<string, WebOrg> = {
  ns: {
    slug: "ns",
    name: "Network School",
    accent: "#006DFF",
    themeDefault: "dark",
    title: "CCWarriors × Network School",
    tagline: "Who's burning the most at Network School.",
    url: "https://ns.com",
    // Network-state crowd pays in crypto first.
    payments: "crypto-first",
  },
};

/** Org for this page load: subdomain in prod (ns.ccwarriors.xyz), ?org=ns locally. */
export function detectOrg(): WebOrg | null {
  try {
    const override = new URLSearchParams(window.location.search).get("org");
    if (override && WEB_ORGS[override]) return WEB_ORGS[override]!;
    const sub = window.location.hostname.split(".")[0] ?? "";
    return WEB_ORGS[sub] ?? null;
  } catch {
    return null;
  }
}
