import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import { CROSSINGS } from "./hero";

const sfx = (f: string) => staticFile(`sfx/${f}`);

// Scene cut frames (kept in sync with Root.T)
const BOARD_AT = 360;
const CTA_AT = 1080;

/**
 * The synthesized EDM track carries the film; on top, a thin diegetic layer:
 * row-arrival ticks, overtake hits, and the domain thump.
 */
export const Score: React.FC = () => {
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
