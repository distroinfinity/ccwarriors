import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { CROSSINGS } from "./hero";

const sfx = (f: string) => staticFile(`sfx/${f}`);

// Scene cut frames (kept in sync with Root.T)
const BOARD_AT = 360;
const CTA_AT = 1080;

// Profile film beat map (kept in sync with Root.PAT)
const P_MAST_AT = 120;
const P_CRAFT_AT = 360;
const P_FLURRY_AT = 720;
const P_CTA_AT = 960;

/**
 * Profile score: the synthesized track plus a thin diegetic layer placed on the
 * profile beat map — masthead/craft impacts, pillar-bar ticks, flurry whooshes,
 * and the domain thump.
 */
const ProfileScore: React.FC = () => {
  const barTicks = Array.from({ length: 6 }, (_, i) => P_CRAFT_AT + 72 + i * 8);
  return (
    <>
      <Audio src={sfx("track-profile.wav")} volume={0.95} />

      {/* masthead lands (DROP1) */}
      <Sequence from={P_MAST_AT} durationInFrames={24}>
        <Audio src={sfx("boom.wav")} volume={0.4} playbackRate={1.2} />
      </Sequence>

      {/* craft reveal (DROP2) + the tier stamp */}
      <Sequence from={P_CRAFT_AT} durationInFrames={24}>
        <Audio src={sfx("boom.wav")} volume={0.5} playbackRate={1.1} />
      </Sequence>
      <Sequence from={P_CRAFT_AT + 34} durationInFrames={20}>
        <Audio src={sfx("thump.wav")} volume={0.4} />
      </Sequence>

      {/* pillar bars cascading in */}
      {barTicks.map((at, i) => (
        <Sequence key={`b${i}`} from={at} durationInFrames={6}>
          <Audio src={sfx("tick.wav")} volume={0.32} playbackRate={1 + i * 0.08} />
        </Sequence>
      ))}

      {/* flurry beats whoosh past */}
      {[P_FLURRY_AT, P_FLURRY_AT + 76, P_FLURRY_AT + 156].map((at, i) => (
        <Sequence key={`w${i}`} from={at} durationInFrames={40}>
          <Audio src={sfx("whoosh.wav")} volume={0.4} />
        </Sequence>
      ))}

      {/* domain lockup lands */}
      <Sequence from={P_CTA_AT + 124} durationInFrames={60}>
        <Audio src={sfx("thump.wav")} volume={0.55} />
      </Sequence>
    </>
  );
};

/**
 * The synthesized EDM track carries the film; on top, a thin diegetic layer:
 * row-arrival ticks, overtake hits, and the domain thump.
 */
export const Score: React.FC<{ variant?: "launch" | "profile" }> = ({ variant = "launch" }) => {
  if (variant === "profile") return <ProfileScore />;
  const rowTicks = Array.from({ length: 10 }, (_, i) => BOARD_AT + 10 + i * 5);
  return (
    <>
      <Audio src={sfx("track.wav")} volume={0.95} />

      {/* leaderboard rows arriving */}
      {rowTicks.map((at, i) => (
        <Sequence key={`r${i}`} from={at} durationInFrames={6}>
          <Audio src={sfx("tick.wav")} volume={0.16} playbackRate={1 + i * 0.04} />
        </Sequence>
      ))}

      {/* hero overtakes — rising pitch per rank gained (frames are board-local) */}
      {CROSSINGS.map((f, i) => (
        <Sequence key={`c${i}`} from={BOARD_AT + f} durationInFrames={8}>
          <Audio src={sfx("tick.wav")} volume={0.5} playbackRate={1 + i * 0.16} />
        </Sequence>
      ))}
      {CROSSINGS.map((f, i) => (
        <Sequence key={`cb${i}`} from={BOARD_AT + f} durationInFrames={20}>
          <Audio src={sfx("boom.wav")} volume={0.28 + i * 0.06} playbackRate={1.3} />
        </Sequence>
      ))}

      {/* domain lockup lands */}
      <Sequence from={CTA_AT + 58} durationInFrames={60}>
        <Audio src={sfx("thump.wav")} volume={0.55} />
      </Sequence>
    </>
  );
};
