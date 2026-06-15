import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { C, FONT } from "../lib/brand";
import { Grain, Vignette } from "../lib/fx";

const LINE = "how many tokens are you burning?";

// Per-char reveal frames: steady cadence with human jitter, all deterministic.
const charAt = (i: number) => 10 + i * 2.2 + random(`t${i}`) * 3;

export const ColdOpen: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = LINE.split("").filter((_, i) => frame >= charAt(i)).length;
  const done = typed >= LINE.length;
  const cursorOn = done ? Math.floor(frame / 16) % 2 === 0 : true;

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
          position: "relative",
        }}
      >
        {glitch && (
          <>
            <span style={{ position: "absolute", left: gx, top: 0, color: "#ff5544", opacity: 0.6 }}>
              <span style={{ color: "#ff5544" }}>{LINE.slice(0, typed)}</span>
            </span>
            <span style={{ position: "absolute", left: -gx, top: 0, color: "#44ffee", opacity: 0.6 }}>
              {LINE.slice(0, typed)}
            </span>
          </>
        )}
        <span style={{ color: C.muted }}>$ </span>
        <span style={{ position: "relative" }}>{LINE.slice(0, typed)}</span>
        <span
          style={{
            display: "inline-block",
            width: 24,
            height: 50,
            marginLeft: 8,
            verticalAlign: "text-bottom",
            background: C.or,
            opacity: cursorOn ? 1 : 0,
            boxShadow: `0 0 18px ${C.or}88`,
          }}
        />
      </div>
      {/* subtle scanlines for the terminal feel */}
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(to bottom, transparent 0 3px, rgba(0,0,0,.18) 3px 4px)",
          opacity: 0.5,
          pointerEvents: "none",
        }}
      />
      <Vignette strength={0.65} />
      <Grain opacity={0.08} />
      {/* fade from black at the very start */}
      <AbsoluteFill
        style={{
          background: "#000",
          opacity: interpolate(frame, [0, 12], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
