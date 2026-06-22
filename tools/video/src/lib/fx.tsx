import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "./brand";

// ── Film grain: baked SVG noise tile, re-positioned every frame ──────────
const NOISE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
const NOISE_URI = `url("data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}")`;

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundImage: NOISE_URI,
        backgroundPosition: `${Math.floor(random(`gx${frame}`) * 300)}px ${Math.floor(random(`gy${frame}`) * 300)}px`,
        mixBlendMode: "overlay",
        opacity,
        pointerEvents: "none",
      }}
    />
  );
};

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.55 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,${strength}) 100%)`,
      pointerEvents: "none",
    }}
  />
);

// ── The product's perspective grid floor, scrolling toward the horizon ───
export const GridFloor: React.FC<{ speed?: number; color?: string }> = ({
  speed = 0.5,
  color = C.grid,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: "-40%",
        right: "-40%",
        bottom: "-34%",
        height: "64%",
        backgroundImage: `linear-gradient(${color} 1.5px, transparent 1.5px), linear-gradient(90deg, ${color} 1.5px, transparent 1.5px)`,
        backgroundSize: "46px 46px",
        backgroundPosition: `0px ${(frame * speed) % 46}px`,
        transform: "perspective(420px) rotateX(60deg)",
        transformOrigin: "bottom",
        WebkitMaskImage: "linear-gradient(to top, black, transparent)",
        maskImage: "linear-gradient(to top, black, transparent)",
        pointerEvents: "none",
      }}
    />
  );
};

// ── Pixel embers rising — square particles, brand terracotta/ember ───────
export const EmberField: React.FC<{ count?: number; intensity?: number }> = ({
  count = 36,
  intensity = 1,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const embers = [];
  for (let i = 0; i < count; i++) {
    const x0 = random(`ex${i}`) * width;
    const speed = 0.10 + random(`es${i}`) * 0.16;
    const phase = random(`ep${i}`);
    const size = 2 + Math.floor(random(`ez${i}`) * 4);
    const progress = ((frame / fps) * speed + phase) % 1;
    const y = height * (1.04 - progress * 1.12);
    const sway = Math.sin(progress * Math.PI * 2 * (1 + random(`ew${i}`) * 2) + i) * 36;
    const opacity = Math.sin(progress * Math.PI) * (0.35 + random(`eo${i}`) * 0.55) * intensity;
    const col = i % 3 === 0 ? C.ember : i % 3 === 1 ? C.or : C.emberDeep;
    embers.push(
      <div
        key={i}
        style={{
          position: "absolute",
          left: x0 + sway,
          top: y,
          width: size,
          height: size,
          background: col,
          opacity,
          borderRadius: 1,
          boxShadow: `0 0 ${size * 2.5}px ${col}`,
        }}
      />
    );
  }
  return <AbsoluteFill style={{ pointerEvents: "none" }}>{embers}</AbsoluteFill>;
};

// ── Virtual camera: scale/translate wrapper for push-ins and dollies ─────
export const Camera: React.FC<{
  scale?: number;
  x?: number;
  y?: number;
  rotate?: number;
  children: React.ReactNode;
}> = ({ scale = 1, x = 0, y = 0, rotate = 0, children }) => (
  <AbsoluteFill
    style={{ transform: `scale(${scale}) translate(${x}px, ${y}px) rotate(${rotate}deg)` }}
  >
    {children}
  </AbsoluteFill>
);

// ── 5-frame white flash for hard cuts ─────────────────────────────────────
export const Flash: React.FC<{ at?: number; peak?: number }> = ({ at = 0, peak = 0.85 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [at, at + 5], [peak, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ background: "#fff", opacity, pointerEvents: "none" }} />;
};

// ── Camera shake from deterministic noise ─────────────────────────────────
export function shake(frame: number, amp: number, seed = "shk"): { x: number; y: number } {
  const x = (random(`${seed}x${frame}`) - 0.5) * 2 * amp;
  const y = (random(`${seed}y${frame}`) - 0.5) * 2 * amp;
  return { x, y };
}
