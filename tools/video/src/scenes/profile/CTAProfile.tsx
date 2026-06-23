import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../../lib/brand";
import { ClawdAssemble } from "../../lib/Clawd";
import { EmberField, Grain, GridFloor, Vignette } from "../../lib/fx";

// Scene 5 — tease the series, then the lockup. Clawd assembles, the tagline
// flips the leaderboard line, and the personal URL glows.
export const CTAProfile: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const teaser =
    interpolate(frame, [10, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) *
    interpolate(frame, [46, 60], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tagIn = interpolate(frame, [108, 128], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const domainSpring = spring({ frame: frame - 124, fps, config: { damping: 12, mass: 0.7 } });
  const fadeOut = interpolate(frame, [durationInFrames - 28, durationInFrames - 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={0.5} />
      <EmberField count={20} intensity={0.5} />

      {/* series tease, then it clears for the lockup */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 30, letterSpacing: "0.22em", textTransform: "uppercase", color: C.muted, opacity: teaser }}>
          every signal, its own drop — soon
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <ClawdAssemble startFrame={64} width={300} />
        <div
          style={{
            marginTop: 14,
            fontFamily: FONT.body,
            fontSize: 44,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: C.ink,
            opacity: tagIn,
            transform: `translateY(${(1 - tagIn) * 16}px)`,
          }}
        >
          More than a rank.
        </div>
        <div
          style={{
            marginTop: 32,
            fontFamily: FONT.pixel,
            fontSize: 104,
            letterSpacing: "0.04em",
            color: C.or,
            opacity: Math.min(1, domainSpring * 1.2),
            transform: `scale(${0.85 + domainSpring * 0.15})`,
            textShadow: `0 0 60px ${C.or}66, 0 0 18px ${C.or}44`,
          }}
        >
          ccwarriors.xyz
        </div>
      </AbsoluteFill>

      <Vignette strength={0.5} />
      <Grain opacity={0.05} />
      <AbsoluteFill style={{ background: "#000", opacity: fadeOut, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
