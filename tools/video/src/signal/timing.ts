// Timeline constants for the Signal film. 1800 frames @ 30fps = 60s.
// Shot boundaries are the single source of truth for beat sequencing.
export const FPS = 30;
// Provisional visual-cut length; expands to ~60s when retimed to the voiceover.
export const DURATION = 1680;

export const SHOTS = [
  { key: "open", start: 0, end: 300 },
  { key: "hero", start: 300, end: 600 },
  // efficiency / craft / pull-back / CTA beats appended as they're built
] as const;
