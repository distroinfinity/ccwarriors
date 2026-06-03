// Tiny zero-dependency PNG toolkit: encoder, canvas, the Clawd sprite, 5x7 pixel font.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

export function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

export function makeCanvas(w, h, bg = null) {
  const buf = Buffer.alloc(w * h * 4); // transparent by default
  if (bg) {
    const [r, g, b, a] = hex(bg);
    for (let i = 0; i < w * h; i++) buf.set([r, g, b, a], i * 4);
  }
  return buf;
}

export function fillRect(buf, W, x, y, w, h, color) {
  const [r, g, b, a] = hex(color);
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) buf.set([r, g, b, a], (yy * W + xx) * 4);
}

export const cellPainter = (buf, W, cell, ox, oy) => (col, row, color) =>
  fillRect(buf, W, ox + col * cell, oy + row * cell, cell, cell, color);

// ---- the armed Clawd (locked design); spans cols -7..28, rows -2..19 ----
const OR = "#CC785C", BL = "#9aa6b3", BH = "#dfe6ec", ST = "#3f4854",
      GR = "#74471f", SH = "#aeb7c2", RM = "#434b56";
const isEye = (c, r) => ((c === 4 || c === 5) && r >= 4 && r <= 7) || ((c === 18 || c === 19) && r >= 4 && r <= 7);

export function drawClawd(px) {
  for (let c = 0; c <= 23; c++) for (let r = 0; r <= 15; r++) if (!isEye(c, r)) px(c, r, OR);
  for (let nr = 8; nr <= 11; nr++) { px(-2, nr, OR); px(-1, nr, OR); px(24, nr, OR); px(25, nr, OR); }
  for (const [a, b] of [[4, 5], [8, 9], [14, 15], [18, 19]])
    for (let lr = 16; lr <= 19; lr++) { px(a, lr, OR); px(b, lr, OR); }
  for (let b = -2; b <= 6; b++) { px(26, b, BH); px(27, b, BL); }
  px(26, -2, BH); px(27, -2, BH);
  for (const g of [25, 26, 27, 28]) px(g, 7, ST);
  for (let gr = 8; gr <= 10; gr++) { px(26, gr, GR); px(27, gr, GR); }
  px(26, 11, ST); px(27, 11, ST);
  const sh = (c, r, rim) => px(c, r, rim ? RM : SH);
  sh(-6, 6, 1); sh(-5, 6, 1); sh(-4, 6, 1);
  for (let sr = 7; sr <= 11; sr++) { sh(-7, sr, 1); sh(-6, sr, 0); sh(-5, sr, 0); sh(-4, sr, 0); sh(-3, sr, 1); }
  sh(-6, 12, 1); sh(-5, 12, 0); sh(-4, 12, 1); sh(-5, 13, 1);
  for (const [c, r] of [[-5, 8], [-6, 9], [-5, 9], [-4, 9], [-5, 10]]) px(c, r, OR);
}

// ---- 5x7 pixel font ----
export const FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
};

// Draws monospace text; returns the x position after the last glyph.
export function drawText(buf, W, text, x, y, scale, color) {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch.toUpperCase()] ?? FONT[" "];
    for (let r = 0; r < 7; r++)
      for (let c = 0; c < 5; c++)
        if (glyph[r][c] === "#") fillRect(buf, W, cx + c * scale, y + r * scale, scale, scale, color);
    cx += 6 * scale;
  }
  return cx;
}
