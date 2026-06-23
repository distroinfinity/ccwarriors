import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { FONT } from "../../lib/brand";
import { ACCENT, INK, MUTED } from "./Line";
import { Paper } from "./Paper";

// Accessible big-number beat: a small mono kicker, a huge tabular value, a
// plain-language label (sans), and an optional sublabel. No code syntax — for
// the audience that doesn't read code. Sharp, editorial, on paper.
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ec = (a: number, b: number, fromV: number, toV: number, frame: number) =>
  interpolate(frame, [a, b], [fromV, toV], { ...clamp, easing: Easing.out(Easing.cubic) });

export const BigStat: React.FC<{ kicker?: string; value: string; label: string; sublabel?: string; accent?: boolean }> = ({
  kicker,
  value,
  label,
  sublabel,
  accent,
}) => {
  const f = useCurrentFrame();
  const kO = interpolate(f, [0, 14], [0, 1], clamp);
  const vO = interpolate(f, [6, 22], [0, 1], clamp);
  const vS = ec(6, 26, 0.92, 1, f);
  const lO = interpolate(f, [22, 36], [0, 1], clamp);
  const sO = interpolate(f, [32, 46], [0, 1], clamp);

  return (
    <Paper>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        {kicker && (
          <div style={{ fontFamily: FONT.mono, fontSize: 24, letterSpacing: "0.4em", textTransform: "uppercase", color: ACCENT, opacity: kO }}>
            {kicker}
          </div>
        )}
        <div
          style={{
            fontFamily: FONT.mono,
            fontWeight: 700,
            fontSize: 210,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: accent ? ACCENT : INK,
            fontVariantNumeric: "tabular-nums",
            opacity: vO,
            transform: `scale(${vS})`,
          }}
        >
          {value}
        </div>
        <div style={{ fontFamily: FONT.body, fontSize: 36, color: MUTED, opacity: lO }}>{label}</div>
        {sublabel && <div style={{ fontFamily: FONT.body, fontSize: 23, color: MUTED, opacity: sO, letterSpacing: "0.01em" }}>{sublabel}</div>}
      </div>
    </Paper>
  );
};
