import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "./brand";

// A light, consistent "finished release" grade applied over every scene: warm
// terracotta lift in the shadows, a cool roll-off up top for contrast, and a
// soft center bloom. The heavier contrast/curve pass happens in ffmpeg post.
export const GradeOverlay: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill style={{ background: `radial-gradient(135% 100% at 50% 62%, transparent 52%, ${C.or}1c 100%)`, mixBlendMode: "soft-light" }} />
    <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(94,127,160,0.12) 0%, transparent 42%)", mixBlendMode: "soft-light" }} />
    <AbsoluteFill style={{ background: `radial-gradient(58% 44% at 50% 50%, ${C.ember}12, transparent 70%)`, mixBlendMode: "screen" }} />
  </AbsoluteFill>
);
