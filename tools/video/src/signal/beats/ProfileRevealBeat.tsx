import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FONT, formatUsd } from "../../lib/brand";
import { PROFILE, SIG_OPACITY } from "../../lib/profileData";
import { useVertical } from "../doc/Line";

// The product payoff — the real profile page first-fold, full-bleed in light
// theme (the page's own default), with a gentle scroll from masthead → Craft
// Score → By the Numbers. Faithful recreation, real data.
const INK = "#16140F";
const MUTED = "#857F73";
const BRONZE = "#9A6B3F";
const OR = "#C2683E";
const LINE = "#E7E4DC";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Pill: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: FONT.mono, fontSize: 18, fontWeight: 600, letterSpacing: "0.04em", color: OR, border: `1px solid ${OR}`, borderRadius: 999, padding: "4px 12px" }}>
    <span style={{ fontSize: 13 }}>✓</span>
    {children}
  </span>
);

const Group: React.FC<{ title: string; rows: [string, string][] }> = ({ title, rows }) => (
  <div>
    <div style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: "0.14em", color: BRONZE, marginBottom: 10 }}>{title}</div>
    {rows.map(([v, l], i) => (
      <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 9 }}>
        <b style={{ fontFamily: FONT.mono, fontSize: 38, color: INK, minWidth: 130, fontWeight: 700 }}>{v}</b>
        <span style={{ fontFamily: FONT.body, fontSize: 22, color: MUTED }}>{l}</span>
      </div>
    ))}
  </div>
);

export const ProfileRevealBeat: React.FC = () => {
  const f = useCurrentFrame();
  const vertical = useVertical();
  const fade = interpolate(f, [0, 18], [0, 1], clamp);
  const scroll = vertical
    ? interpolate(f, [22, 250], [200, -360], { ...clamp, easing: Easing.inOut(Easing.cubic) })
    : interpolate(f, [22, 250], [40, -270], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const fit = vertical ? 0.96 : 1;
  const top = vertical ? 150 : 80;
  const stack = PROFILE.stackLangs;

  return (
    <AbsoluteFill style={{ background: "#FAFAF8", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top, width: 1080, transform: `translateX(-50%) translateY(${scroll}px) scale(${fit})`, opacity: fade }}>
        {/* masthead / craft card */}
        <div style={{ background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 16, padding: "50px 56px", boxShadow: "0 1px 2px rgba(22,20,15,.04), 0 18px 44px rgba(22,20,15,.06)" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 21, letterSpacing: "0.2em", color: BRONZE }}>FIELD REPORT · CCWARRIORS</div>
          <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 22 }}>
            {PROFILE.avatar && <Img src={staticFile(PROFILE.avatar)} style={{ width: 86, height: 86, borderRadius: 8, objectFit: "cover", border: `1px solid ${LINE}` }} />}
            <div style={{ fontFamily: FONT.pixel, fontSize: 94, lineHeight: 1, color: INK, letterSpacing: "0.03em" }}>{PROFILE.login}</div>
          </div>
          <div style={{ marginTop: 18, fontFamily: FONT.mono, fontSize: 23, color: MUTED }}>
            rank #{PROFILE.rank} · since {PROFILE.sinceYear} · {formatUsd(PROFILE.allTimeUsd)} all-time
          </div>
          <div style={{ marginTop: 26, fontFamily: FONT.body, fontSize: 30, lineHeight: 1.5, color: INK, maxWidth: "40em", fontWeight: 500 }}>{PROFILE.verdict}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginTop: 30, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT.pixel, fontSize: 118, lineHeight: 0.9, color: OR, letterSpacing: "-0.01em" }}>{PROFILE.craft}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 28, letterSpacing: "0.16em", color: MUTED }}>CRAFT</span>
            <span style={{ color: LINE }}>/</span>
            <span style={{ fontFamily: FONT.pixel, fontSize: 34, color: OR, letterSpacing: "0.06em" }}>{PROFILE.tierName}</span>
            <span style={{ color: LINE }}>/</span>
            <span style={{ fontFamily: FONT.mono, fontSize: 22, color: MUTED }}>top signal {PROFILE.topPillar?.label} {PROFILE.topPillar?.value}</span>
            {PROFILE.verified && <Pill>VERIFIED</Pill>}
            {PROFILE.githubVerified && <Pill>GITHUB</Pill>}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 118, marginTop: 28, width: 560 }}>
            {PROFILE.pillars.map((p) => (
              <div key={p.key} style={{ flex: 1, maxWidth: 84, height: `${Math.max(12, p.value)}%`, background: OR, opacity: SIG_OPACITY[p.rankClass] ?? 0.35, borderRadius: "3px 3px 0 0" }} />
            ))}
          </div>
          <div style={{ marginTop: 26, fontFamily: FONT.mono, fontSize: 18, color: MUTED, textDecoration: "underline", textUnderlineOffset: 3 }}>full score breakdown</div>
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${LINE}`, fontFamily: FONT.mono, fontSize: 20, color: MUTED }}>ccwarriors.xyz/{PROFILE.login}</div>
        </div>

        {/* by the numbers */}
        <div style={{ marginTop: 44 }}>
          <div style={{ fontFamily: FONT.mono, fontSize: 19, letterSpacing: "0.14em", color: BRONZE, marginBottom: 20 }}>BY THE NUMBERS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "34px 90px" }}>
            <Group title="OUTCOMES" rows={[[`$${PROFILE.costPerLine}`, "per surviving line"], [PROFILE.grade ?? "—", "cache efficiency"]]} />
            <Group title="SESSIONS" rows={[[String(PROFILE.sessions), `sessions, ${PROFILE.windowDays}d`], [`${PROFILE.planModePct}%`, "in plan mode"]]} />
            <Group title="GITHUB · VERIFIED" rows={[[`★ ${PROFILE.github?.stars ?? 0}`, "stars"], [String(PROFILE.github?.prs ?? 0), "public PRs merged"]]} />
            <Group title="BUILDS WITH" rows={[[stack[0]?.name ?? "—", stack.slice(1, 3).map((l) => l.name).join(" · ") || "top language"]]} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
