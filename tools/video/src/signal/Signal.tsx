import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { ColdOpenBeat } from "./beats/ColdOpenBeat";
import { HeroDataBeat } from "./beats/HeroDataBeat";
import { SignalEmphasisBeat } from "./beats/SignalEmphasisBeat";
import { LeaderboardBeat } from "./beats/LeaderboardBeat";
import { ProfileRevealBeat } from "./beats/ProfileRevealBeat";
import { CTABeat } from "./beats/CTABeat";
import { SignalScore } from "./SignalScore";

// "The New Signal" — editorial digital-paper / typewriter film (flat DOM, light
// mode). Code is used minimally (cold open + one signature block); the rest is
// accessible big-number editorial. Beats are paced to the voiceover segments.
export const Signal: React.FC = () => (
  <AbsoluteFill style={{ background: "#FAFAF8" }}>
    <Sequence durationInFrames={410}>
      <ColdOpenBeat />
    </Sequence>
    <Sequence from={410} durationInFrames={310}>
      <HeroDataBeat />
    </Sequence>
    <Sequence from={720} durationInFrames={220}>
      <SignalEmphasisBeat />
    </Sequence>
    <Sequence from={940} durationInFrames={220}>
      <LeaderboardBeat />
    </Sequence>
    <Sequence from={1160} durationInFrames={300}>
      <ProfileRevealBeat />
    </Sequence>
    <Sequence from={1460} durationInFrames={220}>
      <CTABeat />
    </Sequence>
    <SignalScore />
  </AbsoluteFill>
);
