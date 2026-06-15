import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../lib/brand";
import { DATA } from "../lib/data";
import { Camera, EmberField, Flash, Grain, GridFloor, Vignette } from "../lib/fx";

const DIGIT_H = 1.06; // line-height multiplier per digit cell

/**
 * Continuous odometer: every digit column's offset is derived from the raw
 * value, so cents spin fast while thousands creep — the classic live-meter
 * feel. Non-digit chars ($ , .) stay put.
 */
const Odometer: React.FC<{ value: number; fontSize: number; color: string }> = ({
  value,
  fontSize,
  color,
}) => {
  const str =
    "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const H = fontSize * DIGIT_H;
  // digit place k counted from the right over digits only (cents = 0,1)
  const digitsOnly = str.replace(/[^0-9]/g, "");
  let seen = 0;
  const cells = str.split("").map((ch, idx) => {
    if (!/[0-9]/.test(ch)) {
      return (
        <span key={idx} style={{ display: "inline-block", transform: "translateY(0)" }}>
          {ch}
        </span>
      );
    }
    const k = digitsOnly.length - 1 - seen; // 0 = last cent digit
    seen += 1;
    // Snap to the integer digit; roll only while the place below wraps 9→0,
    // so thousands sit still while cents spin — readable, still alive.
    const raw = (value * 100) / 10 ** k;
    const intDigit = Math.floor(raw) % 10;
    const below = raw % 1;
    const roll = below > 0.82 ? (below - 0.82) / 0.18 : 0;
    const pos = intDigit + roll * roll * (3 - 2 * roll); // smoothstep into next digit
    return (
      <span
        key={idx}
        style={{
          display: "inline-block",
          height: H,
          overflow: "hidden",
          verticalAlign: "top",
        }}
      >
        <span
          style={{
            display: "block",
            transform: `translateY(${-pos * H}px)`,
          }}
        >
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, j) => (
            <span key={j} style={{ display: "block", height: H, lineHeight: `${H}px` }}>
              {d}
            </span>
          ))}
        </span>
      </span>
    );
  });
  return (
    <div
      style={{
        fontFamily: FONT.mono,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 800,
        fontSize,
        color,
        letterSpacing: "-0.02em",
        display: "flex",
        height: H,
        lineHeight: `${H}px`,
      }}
    >
      {cells}
    </div>
  );
};

export const BurnCounter: React.FC = () => {
  const frame = useCurrentFrame();
  const total = DATA.totalBurned30d;

  // Sprint from ~75% to the live figure, then keep drifting like the prod ticker
  const approach = interpolate(frame, [0, 105], [total - 32000, total], {
    easing: Easing.out(Easing.exp),
    extrapolateRight: "clamp",
  });
  const value = frame <= 105 ? approach : total + (frame - 105) * 0.43;

  const camScale = interpolate(frame, [0, 240], [1.0, 1.1]);
  const labelIn = interpolate(frame, [16, 34], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={0.8} />
      <EmberField count={42} />
      <Camera scale={camScale}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          {/* the number breathes with the kick — 15 frames per beat at 120 BPM */}
          <div
            style={{
              transform: `scale(${1 + Math.exp(-(frame % 15) / 5) * 0.008})`,
              filter: `drop-shadow(0 0 ${18 + Math.exp(-(frame % 15) / 5) * 26}px ${C.or}44)`,
            }}
          >
            <Odometer value={Math.max(0, value)} fontSize={148} color={C.ink} />
          </div>
          <div
            style={{
              marginTop: 38,
              fontFamily: FONT.body,
              fontSize: 23,
              fontWeight: 600,
              letterSpacing: "0.42em",
              color: C.or,
              opacity: labelIn,
              transform: `translateY(${(1 - labelIn) * 14}px)`,
            }}
          >
            BURNED · LAST 30 DAYS
          </div>
          <div
            style={{
              marginTop: 18,
              fontFamily: FONT.mono,
              fontSize: 17,
              color: C.muted,
              opacity: interpolate(frame, [40, 58], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            across {DATA.warriorCount} warriors · live
          </div>
        </AbsoluteFill>
      </Camera>
      {/* product anchor: brand + live dot */}
      <div
        style={{
          position: "absolute",
          top: 44,
          left: 60,
          fontFamily: FONT.pixel,
          fontSize: 26,
          letterSpacing: "0.08em",
          color: C.muted,
        }}
      >
        ccwarriors
      </div>
      <div
        style={{
          position: "absolute",
          top: 48,
          right: 60,
          display: "flex",
          alignItems: "center",
          gap: 9,
          fontFamily: FONT.mono,
          fontSize: 15,
          letterSpacing: "0.2em",
          color: C.muted,
        }}
      >
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: C.or,
            boxShadow: `0 0 ${6 + Math.sin(frame / 6) * 4}px ${C.or}`,
          }}
        />
        LIVE
      </div>
      <Vignette />
      <Grain />
      <Flash at={0} peak={0.75} />
    </AbsoluteFill>
  );
};
