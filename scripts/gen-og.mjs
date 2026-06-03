// Generates the share-preview banner (1200x630) + favicon. Zero dependencies.
// Usage: node scripts/gen-og.mjs
//   → assets/og-banner-1200x630.png  (+ copied to apps/web/public/og.png)
//   → assets/favicon-256.png         (+ copied to apps/web/public/favicon.png)
import { writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { encodePng, makeCanvas, fillRect, cellPainter, drawClawd, drawText } from "./pnglib.mjs";

mkdirSync("assets", { recursive: true });

// ---- OG banner 1200x630 ----
const W = 1200, H = 630;
const buf = makeCanvas(W, H, "#0A0A0B");
fillRect(buf, W, 0, 0, W, 3, "#B88A63"); // bronze top edge

// armed Clawd, left side (sprite spans cols -7..28, rows -2..19)
const cell = 11;
drawClawd(cellPainter(buf, W, cell, 80 + 7 * cell, 216));

// wordmark + tagline + domain, right side
drawText(buf, W, "CCWARRIORS", 560, 205, 7, "#ECEAE3");
const tagX = drawText(buf, W, "TOKEN BURN RATE, ", 560, 300, 3, "#9aa0a6");
drawText(buf, W, "RANKED.", tagX, 300, 3, "#CC785C");
drawText(buf, W, "CCWARRIORS.XYZ", 560, 356, 3, "#6f6a60");

writeFileSync("assets/og-banner-1200x630.png", encodePng(W, H, buf));
copyFileSync("assets/og-banner-1200x630.png", "apps/web/public/og.png");
console.log("wrote assets/og-banner-1200x630.png (+ apps/web/public/og.png)");

// ---- favicon 256x256 (transparent) ----
const F = 256;
const fav = makeCanvas(F, F, null);
drawClawd(cellPainter(fav, F, 6, 62, 74));
writeFileSync("assets/favicon-256.png", encodePng(F, F, fav));
copyFileSync("assets/favicon-256.png", "apps/web/public/favicon.png");
console.log("wrote assets/favicon-256.png (+ apps/web/public/favicon.png)");
