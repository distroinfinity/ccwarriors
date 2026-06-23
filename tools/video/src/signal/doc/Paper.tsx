import React from "react";
import { AbsoluteFill } from "remotion";
import { PAPER1, PAPER2 } from "./Line";

// Clean paper canvas (no code chrome) for the accessible big-number beats —
// keeps the editorial paper look without syntax/line-numbers.
export const Paper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: `radial-gradient(130% 130% at 50% 38%, ${PAPER1}, ${PAPER2})`, justifyContent: "center", alignItems: "center" }}>
    {children}
  </AbsoluteFill>
);
