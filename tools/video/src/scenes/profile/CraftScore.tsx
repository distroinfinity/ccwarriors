import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../../lib/brand";
import { Camera, EmberField, Flash, Grain, GridFloor, Vignette } from "../../lib/fx";
import { PROFILE, SIG_OPACITY } from "../../lib/profileData";

// DROP2 lands here. The headline number assembles, the tier stamps, the six
// pillar bars cascade, and the verdict settles. The profile's odometer moment.

const Badge: React.FC<{ label: string; o: number }> = ({ label, o }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: FONT.mono,
      fontSize: 17,
      fontWeight: 600,
      letterSpacing: "0.04em",
      color: C.or,
      border: `1px solid ${C.or}`,
      borderRadius: 999,
      padding: "5px 13px",
      opacity: o,
      transform: `translateY(${(1 - o) * 8}px)`,
    }}
  >
    <span style={{ fontSize: 13 }}>✓</span>
    {label}
  </span>
);

export const CraftScore: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // count-up 0 → craft
  const count = Math.round(
    interpolate(frame, [0, 44], [0, PROFILE.craft], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" }),
  );
  const glow = 26 + Math.exp(-(frame % 15) / 5) * 34; // breathes with the kick
  const breath = 1 + Math.exp(-(frame % 15) / 5) * 0.006;

  const craftLbl = interpolate(frame, [10, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tier = spring({ frame: frame - 34, fps, config: { damping: 11, mass: 0.6 } });
  const verdict = interpolate(frame, [112, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // container settles from a slight 3D tilt, then a slow push-in, with a punch on the drop
  const tilt = interpolate(frame, [0, 44], [7, 0], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" });
  const punch = interpolate(frame, [0, 8], [1.05, 1], { easing: Easing.out(Easing.cubic), extrapolateRight: "clamp" });
  const push = interpolate(frame, [0, 360], [1, 1.04]) * punch;

  const qual = (at: number) =>
    interpolate(frame, [at, at + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <GridFloor speed={0.7} />
      <EmberField count={40} intensity={1} />
      <Camera scale={push}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", perspective: 1500 }}>
          <div style={{ transform: `rotateX(${tilt}deg)`, transformOrigin: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* verdict */}
            <div
              style={{
                maxWidth: 1180,
                textAlign: "center",
                fontFamily: FONT.body,
                fontSize: 30,
                fontWeight: 500,
                lineHeight: 1.5,
                color: C.ink,
                opacity: verdict,
                transform: `translateY(${(1 - verdict) * 12}px)`,
                marginBottom: 30,
              }}
            >
              {PROFILE.verdict}
            </div>

            {/* the number */}
            <div style={{ display: "flex", alignItems: "baseline", gap: 26, transform: `scale(${breath})` }}>
              <span
                style={{
                  fontFamily: FONT.pixel,
                  fontSize: 280,
                  lineHeight: 0.86,
                  color: C.or,
                  letterSpacing: "-0.02em",
                  textShadow: `0 0 ${glow}px ${C.or}66, 0 0 ${glow * 0.4}px ${C.or}55`,
                }}
              >
                {count}
              </span>
              <span style={{ fontFamily: FONT.mono, fontSize: 40, letterSpacing: "0.16em", color: C.muted, opacity: craftLbl }}>
                CRAFT
              </span>
            </div>

            {/* qualifier row */}
            <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 18, fontFamily: FONT.mono, fontSize: 22, color: C.muted }}>
              <span className="px" style={{ fontFamily: FONT.pixel, fontSize: 30, letterSpacing: "0.06em", color: C.or, opacity: tier, transform: `scale(${0.7 + tier * 0.3})`, display: "inline-block" }}>
                {PROFILE.tierName}
              </span>
              <span style={{ color: C.line, opacity: qual(46) }}>/</span>
              <span style={{ opacity: qual(52) }}>
                top signal {PROFILE.topPillar?.label} {PROFILE.topPillar?.value}
              </span>
              <span style={{ color: C.line, opacity: qual(64) }}>/</span>
              {PROFILE.verified && <Badge label="VERIFIED" o={qual(70)} />}
              {PROFILE.githubVerified && <Badge label="GITHUB" o={qual(80)} />}
            </div>

            {/* strength signature bars */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", height: 132, marginTop: 40, width: 660 }}>
              {PROFILE.pillars.map((p, i) => {
                const s = spring({ frame: frame - (72 + i * 8), fps, config: { damping: 15, mass: 0.6 } });
                const h = Math.max(12, p.value);
                return (
                  <i
                    key={p.key}
                    title={`${p.label} ${Math.round(p.value)}`}
                    style={{
                      display: "block",
                      flex: 1,
                      maxWidth: 96,
                      height: `${h}%`,
                      background: C.or,
                      opacity: (SIG_OPACITY[p.rankClass] ?? 0.35) * s,
                      borderRadius: "3px 3px 0 0",
                      transform: `scaleY(${s})`,
                      transformOrigin: "bottom",
                    }}
                  />
                );
              })}
            </div>
          </div>
        </AbsoluteFill>
      </Camera>
      <Vignette strength={0.48} />
      <Grain opacity={0.05} />
      <Flash at={0} peak={0.95} />
    </AbsoluteFill>
  );
};
