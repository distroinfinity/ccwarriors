import { useState } from "react";

const GREYS = ["#5b6066", "#6b7178", "#7c828a", "#666b71", "#74797f", "#5f6469"];

/** Grayscale avatar img; falls back to a colored monogram on error/empty. */
export function Avatar({
  src,
  name,
  index,
  className = "av",
}: {
  src: string;
  name: string;
  index: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const bg = GREYS[index % GREYS.length];
  const letter = (name[0] ?? "?").toUpperCase();

  if (!src || failed) {
    return (
      <div className={className} style={{ background: bg }}>
        {letter}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      style={{ background: bg }}
      onError={() => setFailed(true)}
    />
  );
}
