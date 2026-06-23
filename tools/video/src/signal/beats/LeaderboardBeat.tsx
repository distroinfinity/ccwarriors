import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FONT } from "../../lib/brand";
import { ACCENT, INK, LINENO, MUTED, useVertical } from "../doc/Line";
import { Paper } from "../doc/Paper";
import { DATA } from "../../lib/data";

// The living ecosystem — a lightweight leaderboard with $ amounts ticking up in
// real time (callback to the leaderboard film), distroinfinity ranked among real
// burners. Editorial light styling.
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ROWS = DATA.entries.slice(0, 8);
const usd2 = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const LeaderboardBeat: React.FC = () => {
  const f = useCurrentFrame();
  const vertical = useVertical();
  const total = DATA.totalBurned30d + Math.max(0, f - 8) * (DATA.totalBurned30d * 0.0000012);
  const liveDot = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(f / 5));

  return (
    <Paper>
      <div style={{ width: 1060, transform: vertical ? "scale(0.95)" : undefined }}>
        {/* header — brand + live total */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 24, opacity: interpolate(f, [0, 16], [0, 1], clamp) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontFamily: FONT.pixel, fontSize: 30, color: INK, letterSpacing: "0.04em" }}>ccwarriors</span>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: ACCENT, opacity: liveDot, boxShadow: `0 0 8px ${ACCENT}` }} />
            <span style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: "0.24em", color: MUTED }}>LIVE</span>
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 24, color: INK, fontVariantNumeric: "tabular-nums" }}>
            <b style={{ fontWeight: 700 }}>{usd2(total)}</b> <span style={{ color: MUTED, fontSize: 15, letterSpacing: "0.12em" }}>BURNED · 30D</span>
          </div>
        </div>

        {ROWS.map((e, i) => {
          const appear = 14 + i * 6;
          const o = interpolate(f, [appear, appear + 14], [0, 1], clamp);
          const y = interpolate(f, [appear, appear + 14], [14, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
          const settle = interpolate(f, [appear, appear + 26], [e.cost30d * 0.992, e.cost30d], { ...clamp, easing: Easing.out(Easing.cubic) });
          const val = settle + Math.max(0, f - appear - 26) * (e.cost30d * 0.0000016);
          return (
            <div
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                padding: "13px 18px",
                borderBottom: "1px solid #EAE5DA",
                opacity: o,
                transform: `translateY(${y}px)`,
              }}
            >
              <span style={{ width: 42, fontFamily: FONT.mono, fontSize: 22, color: LINENO }}>#{i + 1}</span>
              {e.avatar ? (
                <Img src={staticFile(e.avatar)} style={{ width: 36, height: 36, borderRadius: 7, objectFit: "cover" }} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: 7, background: "#dad6cd" }} />
              )}
              <span style={{ flex: 1, fontFamily: FONT.mono, fontSize: 27, color: INK, fontWeight: 500 }}>{e.login}</span>
              <span style={{ fontFamily: FONT.mono, fontSize: 27, color: INK, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{usd2(val)}</span>
            </div>
          );
        })}
      </div>
    </Paper>
  );
};
