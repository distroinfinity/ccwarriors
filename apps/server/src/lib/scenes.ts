export const CARD_SCENES = [
  "crane", "wave", "fujiDawn", "sakura", "temple",
  "bonsai", "fujiNight", "monk", "torii",
] as const;

export function randomScene(): string {
  return CARD_SCENES[Math.floor(Math.random() * CARD_SCENES.length)] ?? "fujiNight";
}
