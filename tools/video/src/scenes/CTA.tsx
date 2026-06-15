import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, FONT } from "../lib/brand";
import { ClawdAssemble } from "../lib/Clawd";
import { EmberField, Grain, GridFloor, Vignette } from "../lib/fx";

export const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const tagIn = interpolate(frame, [42, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const domainSpring = spring({ frame: frame - 56, fps, config: { damping: 12, mass: 0.7 } });
  const fadeOut = interpolate(frame, [durationInFrames - 28, durationInFrames - 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={0.5} />
      <EmberField count={20} intensity={0.5} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 0 }}>
        <ClawdAssemble startFrame={4} width={330} />
        <div
          style={{
            marginTop: 14,
            fontFamily: FONT.body,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: C.ink,
            opacity: tagIn,
            transform: `translateY(${(1 - tagIn) * 16}px)`,
          }}
        >
          Token burn rate, ranked.
        </div>
        <div
          style={{
            marginTop: 34,
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
      <Vignette />
      <Grain />
      <AbsoluteFill style={{ background: "#000", opacity: fadeOut, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
