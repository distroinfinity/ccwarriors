import React from "react";
import { BigStat } from "../doc/BigStat";
import { SIGNAL } from "../../lib/signalData";

// The punchline, pulled out of the code block into one accessible big number:
// how little a surviving line costs. Anyone gets it — no syntax required.
export const SignalEmphasisBeat: React.FC = () => (
  <BigStat
    kicker="the signal"
    value={`$${SIGNAL.costPerLine}`}
    accent
    label="per surviving line"
    sublabel={`${SIGNAL.commitsPer100} commits per $100   ·   ${SIGNAL.cacheGrade} cache efficiency`}
  />
);
