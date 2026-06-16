import { continueRender, delayRender, staticFile } from "remotion";

// Dark-theme palette lifted verbatim from apps/web/src/index.css
export const C = {
  bg: "#0a0a0b",
  panel: "#111214",
  ink: "#ECEAE3",
  muted: "#8b8f96",
  or: "#CC785C",
  ember: "#E8845C",
  emberDeep: "#8C2F1B",
  bronze: "#B88A63",
  line: "rgba(255,255,255,.09)",
  up: "#3FB97A",
  grid: "rgba(204,120,92,.10)",
};

export const FONT = {
  body: "Geist, sans-serif",
  mono: "'Geist Mono', monospace",
  pixel: "'Pixelify Sans', monospace",
};

export const TIER_GLYPH: Record<string, string> = {
  netherite: "☄",
  diamond: "❖",
  gold: "◆",
  iron: "✦",
  stone: "⬡",
};

export function tierLabel(tier: string): string {
  const g = TIER_GLYPH[tier.toLowerCase()];
  return g ? `${g} ${tier.toUpperCase()}` : tier.toUpperCase();
}

export function formatUsd(n: number): string {
  return (
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

// Deterministic 8-bar sparkline — same hash as apps/web/src/util.ts
export function sparkBars(id: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bars: number[] = [];
  for (let i = 0; i < 8; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    bars.push((Math.abs(h) % 8) + 1);
  }
  return bars;
}

// Variable woff2s live in public/fonts — loaded once per headless page.
if (typeof document !== "undefined") {
  const handle = delayRender("brand fonts");
  const faces: Array<[string, string]> = [
    ["Geist", "fonts/Geist-var.woff2"],
    ["Geist Mono", "fonts/GeistMono-var.woff2"],
    ["Pixelify Sans", "fonts/PixelifySans-var.woff2"],
  ];
  Promise.all(
    faces.map(([family, file]) =>
      new FontFace(family, `url(${staticFile(file)}) format('woff2')`, {
        weight: "100 900",
      })
        .load()
        .then((f) => (document.fonts as unknown as { add(face: FontFace): void }).add(f))
    )
  )
    .then(() => continueRender(handle))
    .catch(() => continueRender(handle));
}
