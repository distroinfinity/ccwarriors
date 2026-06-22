import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../lib/brand";
import { DATA } from "../lib/data";
import { EmberField, Grain, GridFloor, Vignette } from "../lib/fx";

const TOOLS = ["claude code", "codex", "gemini cli", "copilot", "amp"];

// Two smooth cards, one bar each (60f), crossfading — no slams.
const CARD2_IN = 56;

export const Flurry: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 128], [1.0, 1.05]);

  const c1 = interpolate(frame, [0, 14, CARD2_IN - 8, CARD2_IN + 4], [0, 1, 1, 0], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const c1y = interpolate(frame, [0, 14], [22, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const count = Math.round(
    interpolate(frame, [4, 26], [0, DATA.warriorCount], {
      easing: Easing.out(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  const c2 = interpolate(frame, [CARD2_IN, CARD2_IN + 14], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const c2y = interpolate(frame, [CARD2_IN, CARD2_IN + 14], [22, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={1.0} />
      <EmberField count={22} intensity={0.6} />
      <AbsoluteFill style={{ transform: `scale(${drift})` }}>
        {/* card 1: warriors counter */}
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            opacity: c1,
            transform: `translateY(${c1y}px)`,
          }}
        >
          <div
            style={{
              fontFamily: FONT.body,
              fontSize: 150,
              fontWeight: 800,
              color: C.ink,
              letterSpacing: "0.01em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {count} WARRIORS
          </div>
          <div
            style={{
              marginTop: 26,
              fontFamily: FONT.mono,
              fontSize: 25,
              letterSpacing: "0.44em",
              color: C.or,
            }}
          >
            ENLISTED · RANKS MOVE AS YOU BURN
          </div>
        </AbsoluteFill>
        {/* card 2: every agent, one line */}
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            opacity: c2,
            transform: `translateY(${c2y}px)`,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 30 }}>
            {TOOLS.map((tool, i) => {
              const o = interpolate(frame, [CARD2_IN + 6 + i * 4, CARD2_IN + 16 + i * 4], [0, 1], {
                easing: Easing.out(Easing.cubic),
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <React.Fragment key={tool}>
                  {i > 0 && (
                    <span style={{ color: C.or, fontSize: 40, opacity: o }}>·</span>
                  )}
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: 64,
                      fontWeight: 700,
                      color: C.ink,
                      opacity: o,
                    }}
                  >
                    {tool}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 30,
              fontFamily: FONT.mono,
              fontSize: 23,
              letterSpacing: "0.44em",
              color: C.muted,
              opacity: interpolate(frame, [CARD2_IN + 24, CARD2_IN + 38], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            IF CCUSAGE READS IT, IT RANKS
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
      <Vignette strength={0.6} />
      <Grain opacity={0.08} />
    </AbsoluteFill>
  );
};
