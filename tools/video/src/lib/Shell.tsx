import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

/**
 * Scene shell for smooth, music-synced cuts: scenes overlap a few frames and
 * blend with an eased opacity + a continuing zoom so motion carries across
 * the cut instead of slamming. inF/outF of 0 keeps a hard edge (the drops).
 */
export const Shell: React.FC<{
  dur: number;
  inF?: number;
  outF?: number;
  children: React.ReactNode;
}> = ({ dur, inF = 10, outF = 10, children }) => {
  const frame = useCurrentFrame();
  const fadeIn =
    inF === 0
      ? 1
      : interpolate(frame, [0, inF], [0, 1], {
          easing: Easing.out(Easing.cubic),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const fadeOut =
    outF === 0
      ? 1
      : interpolate(frame, [dur - outF, dur], [1, 0], {
          easing: Easing.in(Easing.cubic),
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  const scale =
    (inF === 0 ? 1 : interpolate(frame, [0, inF], [1.025, 1], {
      easing: Easing.out(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })) *
    (outF === 0 ? 1 : interpolate(frame, [dur - outF, dur], [1, 1.02], {
      easing: Easing.in(Easing.quad),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }));
  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut, transform: `scale(${scale})` }}>
      {children}
    </AbsoluteFill>
  );
};
