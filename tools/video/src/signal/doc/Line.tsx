import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT } from "../../lib/brand";

// True when the canvas is portrait (the 9:16 reels cut). Beats read this to
// fit their content to the narrower frame.
export const useVertical = () => {
  const { width, height } = useVideoConfig();
  return height > width;
};

// Shared document line: a line-number gutter + syntax-colored tokens that type
// in (typewriter), an optional terracotta strike, and a blinking cursor when
// the line is active. The whole film is built from these, so centering, gutter,
// and rhythm stay consistent.

export const PAPER1 = "#FFFFFF";
export const PAPER2 = "#F1ECE3";
export const INK = "#1b1813";
export const LINENO = "#C8C2B5";
export const MUTED = "#8a8377";
export const ACCENT = "#C2683E"; // terracotta — strike + cursor
export const SYN = {
  comment: "#5f8f6e",
  keyword: "#9a5fc7",
  key: "#1f7a6d",
  string: "#4d915f",
  num: "#bd5a2e",
  punc: "#a39c90",
};

export const CHAR = 2; // frames per typed character
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type Token = { t: string; c?: string };
export type LineSpec = {
  gutter?: string;
  tokens: Token[];
  type?: number; // frame typing starts (undefined = instant/static)
  strikeAt?: number; // frame strike starts (metrics)
  size?: number;
};

const lineLen = (tokens: Token[]) => tokens.reduce((a, t) => a + t.t.length, 0);

function sliced(tokens: Token[], typed: number): Token[] {
  let count = 0;
  const out: Token[] = [];
  for (const tk of tokens) {
    if (count >= typed) break;
    out.push({ t: tk.t.slice(0, Math.min(tk.t.length, typed - count)), c: tk.c });
    count += tk.t.length;
  }
  return out;
}

export const Line: React.FC<{ spec: LineSpec; active: boolean }> = ({ spec, active }) => {
  const frame = useCurrentFrame();
  const size = spec.size ?? 32;
  const len = lineLen(spec.tokens);
  const typed = spec.type == null ? len : Math.max(0, Math.min(len, Math.floor((frame - spec.type) / CHAR)));
  const vis = sliced(spec.tokens, typed);
  const typing = spec.type != null && frame >= spec.type && frame < spec.type + len * CHAR;
  const cursorO = typing ? 1 : Math.floor(frame / 14) % 2 === 0 ? 1 : 0.16;
  const strikePct = spec.strikeAt != null ? interpolate(frame, [spec.strikeAt, spec.strikeAt + 16], [0, 100], clamp) : 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 30, fontFamily: FONT.mono, fontSize: size, lineHeight: 1.4, minHeight: Math.round(size * 1.3) }}>
      <span style={{ width: 52, textAlign: "right", color: LINENO, fontSize: 24, flex: "none" }}>{spec.gutter ?? ""}</span>
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <span style={{ position: "relative", whiteSpace: "pre" }}>
          {vis.map((t, i) => (
            <span key={i} style={{ color: t.c ?? INK }}>{t.t}</span>
          ))}
          {spec.strikeAt != null && strikePct > 0 && (
            <span style={{ position: "absolute", left: -6, top: "54%", height: Math.max(3, Math.round(size * 0.06)), width: `calc(${strikePct}% + 12px)`, background: ACCENT, transform: "translateY(-50%)" }} />
          )}
        </span>
        {active && <span style={{ display: "inline-block", width: Math.max(4, Math.round(size * 0.085)), height: Math.round(size * 0.86), marginLeft: 5, background: ACCENT, opacity: cursorO }} />}
      </span>
    </div>
  );
};

export const activeIndex = (specs: LineSpec[], frame: number) => {
  let a = -1;
  specs.forEach((l, i) => {
    if (l.type != null && frame >= l.type) a = i;
  });
  return a;
};
