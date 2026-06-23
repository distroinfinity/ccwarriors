import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { FONT } from "../../lib/brand";
import { ACCENT, INK } from "../doc/Line";
import { Paper } from "../doc/Paper";

// Close: the tagline types in (typewriter callback), then the domain lands.
const TAG = "The new signal for how the world builds.";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const CTABeat: React.FC = () => {
  const f = useCurrentFrame();
  const typed = Math.max(0, Math.min(TAG.length, Math.floor((f - 12) / 1.6)));
  const typing = f >= 12 && typed < TAG.length;
  const cursorO = typing ? 1 : Math.floor(f / 14) % 2 === 0 ? 1 : 0.16;
  const domStart = 12 + TAG.length * 1.6 + 16;
  const domO = interpolate(f, [domStart, domStart + 16], [0, 1], clamp);
  const domY = interpolate(f, [domStart, domStart + 16], [10, 0], clamp);

  return (
    <Paper>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 42, maxWidth: 1240, textAlign: "center" }}>
        <div style={{ fontFamily: FONT.body, fontSize: 58, fontWeight: 600, lineHeight: 1.25, letterSpacing: "-0.01em", color: INK }}>
          {TAG.slice(0, typed)}
          <span style={{ display: "inline-block", width: 6, height: 50, marginLeft: 6, background: ACCENT, opacity: cursorO, verticalAlign: "text-bottom" }} />
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 42, color: ACCENT, opacity: domO, transform: `translateY(${domY}px)` }}>ccwarriors.xyz</div>
      </div>
    </Paper>
  );
};
