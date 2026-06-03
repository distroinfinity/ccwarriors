// Generates the CCWarriors logo PNGs (armed pixel Clawd) with zero dependencies.
// Usage: node scripts/gen-logo.mjs   → writes assets/logo-{dark,light}-512.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

// ---------- minimal PNG encoder ----------
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
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- pixel canvas ----------
const SIZE = 512;
const CELL = 12;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];

function makeCanvas(bg) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const [r, g, b, a] = hex(bg);
  for (let i = 0; i < SIZE * SIZE; i++) buf.set([r, g, b, a], i * 4);
  return buf;
}
// content spans cols -7..28 (36) and rows -2..19 (22) → centered
const OX = (SIZE - 36 * CELL) / 2 + 7 * CELL;
const OY = (SIZE - 22 * CELL) / 2 + 2 * CELL;
function px(buf, col, row, color) {
  const [r, g, b, a] = hex(color);
  const x0 = OX + col * CELL;
  const y0 = OY + row * CELL;
  for (let y = y0; y < y0 + CELL; y++)
    for (let x = x0; x < x0 + CELL; x++) buf.set([r, g, b, a], (y * SIZE + x) * 4);
}

// ---------- the armed Clawd (locked design) ----------
const OR = "#CC785C", BL = "#9aa6b3", BH = "#dfe6ec", ST = "#3f4854",
      GR = "#74471f", SH = "#aeb7c2", RM = "#434b56";
const isEye = (c, r) => ((c === 4 || c === 5) && r >= 4 && r <= 7) || ((c === 18 || c === 19) && r >= 4 && r <= 7);

function drawClawd(buf) {
  for (let c = 0; c <= 23; c++) for (let r = 0; r <= 15; r++) if (!isEye(c, r)) px(buf, c, r, OR);
  for (let nr = 8; nr <= 11; nr++) { px(buf, -2, nr, OR); px(buf, -1, nr, OR); px(buf, 24, nr, OR); px(buf, 25, nr, OR); }
  for (const [a, b] of [[4, 5], [8, 9], [14, 15], [18, 19]])
    for (let lr = 16; lr <= 19; lr++) { px(buf, a, lr, OR); px(buf, b, lr, OR); }
  for (let b = -2; b <= 6; b++) { px(buf, 26, b, BH); px(buf, 27, b, BL); }
  px(buf, 26, -2, BH); px(buf, 27, -2, BH);
  for (const g of [25, 26, 27, 28]) px(buf, g, 7, ST);
  for (let gr = 8; gr <= 10; gr++) { px(buf, 26, gr, GR); px(buf, 27, gr, GR); }
  px(buf, 26, 11, ST); px(buf, 27, 11, ST);
  const sh = (c, r, rim) => px(buf, c, r, rim ? RM : SH);
  sh(-6, 6, 1); sh(-5, 6, 1); sh(-4, 6, 1);
  for (let sr = 7; sr <= 11; sr++) { sh(-7, sr, 1); sh(-6, sr, 0); sh(-5, sr, 0); sh(-4, sr, 0); sh(-3, sr, 1); }
  sh(-6, 12, 1); sh(-5, 12, 0); sh(-4, 12, 1); sh(-5, 13, 1);
  for (const [c, r] of [[-5, 8], [-6, 9], [-5, 9], [-4, 9], [-5, 10]]) px(buf, c, r, OR);
}

mkdirSync("assets", { recursive: true });
for (const [name, bg] of [["dark", "#0A0A0B"], ["light", "#F4F3EE"]]) {
  const canvas = makeCanvas(bg);
  drawClawd(canvas);
  const out = `assets/logo-${name}-512.png`;
  writeFileSync(out, encodePng(SIZE, SIZE, canvas));
  console.log(`wrote ${out}`);
}
