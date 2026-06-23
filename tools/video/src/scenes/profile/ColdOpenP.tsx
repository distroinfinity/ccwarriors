import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { C, FONT } from "../../lib/brand";
import { Grain, Vignette } from "../../lib/fx";

// Two-beat terminal that pivots off the leaderboard film: it ranked your burn —
// this one asks who you are. Line 2 lands, blinks, then a glitch hard-cuts to
// the masthead on the drop.
const L1 = "the board ranks your burn.";
const L2 = "but who are you?";

const charAt = (base: number, i: number) => base + i * 2.0 + random(`p${base}${i}`) * 2.4;
const L1_DONE = charAt(8, L1.length - 1) + 2;
const L2_BASE = L1_DONE + 8;

export const ColdOpenP: React.FC = () => {
  const frame = useCurrentFrame();
  const t1 = L1.split("").filter((_, i) => frame >= charAt(8, i)).length;
  const t2 = L2.split("").filter((_, i) => frame >= charAt(L2_BASE, i)).length;
  const l2Done = t2 >= L2.length;
  const cursorOn = l2Done ? Math.floor(frame / 16) % 2 === 0 : true;

  // 4-frame RGB-split glitch right before the hard cut out
  const glitch = frame >= 112 && frame < 116;
  const gx = glitch ? (random(`gl${frame}`) - 0.5) * 10 : 0;

  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 46,
          fontWeight: 500,
          color: C.ink,
          letterSpacing: "-0.01em",
          lineHeight: 1.5,
          position: "relative",
        }}
      >
        <div style={{ position: "relative" }}>
          {glitch && (
            <span style={{ position: "absolute", left: gx, top: 0, color: "#ff5544", opacity: 0.55 }}>
              <span style={{ color: C.muted }}>$ </span>
              {L1.slice(0, t1)}
            </span>
          )}
          <span style={{ color: C.muted }}>$ </span>
          {L1.slice(0, t1)}
        </div>
        <div style={{ position: "relative", opacity: frame >= L2_BASE ? 1 : 0 }}>
          {glitch && (
            <span style={{ position: "absolute", left: -gx, top: 0, color: "#44ffee", opacity: 0.55 }}>
              <span style={{ color: C.or }}>{"> "}</span>
              {L2.slice(0, t2)}
            </span>
          )}
          <span style={{ color: C.or }}>{"> "}</span>
          {L2.slice(0, t2)}
          <span
            style={{
              display: "inline-block",
              width: 22,
              height: 44,
              marginLeft: 8,
              verticalAlign: "text-bottom",
              background: C.or,
              opacity: cursorOn ? 1 : 0,
              boxShadow: `0 0 18px ${C.or}88`,
            }}
          />
        </div>
      </div>
      {/* terminal scanlines */}
      <AbsoluteFill
        style={{
          background: "repeating-linear-gradient(to bottom, transparent 0 3px, rgba(0,0,0,.18) 3px 4px)",
          opacity: 0.5,
          pointerEvents: "none",
        }}
      />
      <Vignette strength={0.6} />
      <Grain opacity={0.05} />
      {/* fade up from black */}
      <AbsoluteFill
        style={{
          background: "#000",
          opacity: interpolate(frame, [0, 12], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
