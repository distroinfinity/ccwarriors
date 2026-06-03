// Ported 1:1 from the SCENES object + base()/moon()/sun()/fog() helpers in card-pack-v2.html.

const moon = (x: number, y: number) =>
  `<circle cx="${x}" cy="${y}" r="58" fill="url(#moong)"/><circle cx="${x}" cy="${y}" r="25" fill="#c4cabf" opacity=".82"/>`;
const sun = (x: number, y: number) =>
  `<circle cx="${x}" cy="${y}" r="64" fill="url(#sung)"/><circle cx="${x}" cy="${y}" r="24" fill="#d9d3c4" opacity=".8"/>`;
const fog = (y: number, o: string) =>
  `<ellipse cx="150" cy="${y}" rx="230" ry="15" fill="#ffffff" opacity="${o}" filter="url(#blur)"/>`;
const bg = (g: string) => `<rect width="300" height="206" fill="url(#${g})"/>`;

export const SCENES: Record<string, string> = {
  fujiNight:
    bg("skyNight") +
    moon(234, 48) +
    fog(118, ".05") +
    '<path d="M0 150 L80 132 L150 56 L220 132 L300 150 L300 206 L0 206Z" fill="#2b333c"/>' +
    '<path d="M134 82 L150 56 L166 82 L150 75 L141 84Z" fill="#cdd3cb" opacity=".5"/>' +
    '<path d="M0 178 L70 156 L150 174 L210 152 L300 168 L300 206 L0 206Z" fill="#141b22"/>',
  fujiDawn:
    bg("skyDawn") +
    sun(150, 54) +
    fog(124, ".18") +
    '<path d="M0 152 L80 134 L150 60 L220 134 L300 152 L300 206 L0 206Z" fill="#4a4742"/>' +
    '<path d="M135 86 L150 60 L165 86 L150 79 L142 88Z" fill="#d8d2c6" opacity=".55"/>' +
    '<path d="M0 180 L70 160 L150 176 L210 156 L300 170 L300 206 L0 206Z" fill="#241f1b"/>' +
    fog(150, ".12"),
  wave:
    bg("skyDay") +
    sun(58, 46) +
    '<path d="M0 150 L300 142 L300 206 L0 206Z" fill="#5a646c"/>' +
    '<path d="M-10 152 C40 100 110 100 150 138 C185 170 232 150 310 150 L310 206 L-10 206Z" fill="#3b4750"/>' +
    '<path d="M150 138 C138 116 116 110 100 116 C120 108 146 120 150 138Z" fill="#aeb6bd" opacity=".5"/>' +
    '<g fill="#d6dadd" opacity=".6"><circle cx="108" cy="116" r="2.4"/><circle cx="124" cy="110" r="1.8"/><circle cx="92" cy="122" r="1.5"/></g>' +
    '<path d="M236 142 L256 120 L276 142Z" fill="#6b757d" opacity=".7"/>',
  bonsai:
    bg("skyFog") +
    fog(108, ".12") +
    '<path d="M0 168 L300 160 L300 206 L0 206Z" fill="#2a2f33"/>' +
    '<ellipse cx="210" cy="168" rx="46" ry="8" fill="#1c2024"/>' +
    '<path d="M188 150 L232 150 L226 166 L194 166Z" fill="#241f1b"/>' +
    '<path d="M210 150 C204 138 222 132 213 120 C206 112 218 104 210 95" stroke="#1c1714" stroke-width="5" fill="none"/>' +
    '<g fill="#2c3a33"><ellipse cx="203" cy="97" rx="22" ry="12"/><ellipse cx="227" cy="108" rx="15" ry="9"/><ellipse cx="195" cy="114" rx="14" ry="8"/></g>',
  sakura:
    bg("skyDusk") +
    moon(236, 48) +
    '<path d="M-4 4 C50 26 100 34 142 64" stroke="#241f22" stroke-width="5" fill="none"/>' +
    '<path d="M40 18 C60 30 80 30 96 44" stroke="#241f22" stroke-width="2.5" fill="none"/>' +
    '<g fill="#b39aa0" opacity=".6"><circle cx="40" cy="40" r="3.2"/><circle cx="66" cy="30" r="2.6"/><circle cx="96" cy="44" r="3"/><circle cx="120" cy="56" r="2.4"/><circle cx="80" cy="50" r="2.2"/><circle cx="54" cy="24" r="2.2"/></g>' +
    '<path d="M0 176 L300 164 L300 206 L0 206Z" fill="#241f26"/>',
  temple:
    bg("skyNight") +
    moon(60, 48) +
    fog(120, ".05") +
    '<path d="M0 162 L300 152 L300 206 L0 206Z" fill="#141b22"/>' +
    '<g fill="#0c1116" transform="translate(86,8)">' +
    '<rect x="120" y="120" width="40" height="40"/><path d="M112 122 L168 122 L150 108 L130 108Z"/>' +
    '<rect x="126" y="92" width="28" height="30"/><path d="M118 94 L162 94 L148 82 L132 82Z"/>' +
    '<rect x="132" y="66" width="16" height="28"/><path d="M126 68 L154 68 L146 56 L134 56Z"/>' +
    '<rect x="138" y="50" width="4" height="16"/></g>',
  monk:
    bg("skyDawn") +
    sun(236, 52) +
    fog(132, ".2") +
    '<path d="M118 206 L150 152 L172 152 L208 206Z" fill="#bdb3a7" opacity=".45"/>' +
    '<path d="M0 170 L300 162 L300 206 L0 206Z" fill="#2a241f"/>' +
    '<path d="M54 122 L86 122 L70 105Z" fill="#241f1b"/>' +
    '<path d="M62 122 C58 142 60 160 64 170 L76 170 C80 160 82 142 78 122Z" fill="#2a2420"/>' +
    '<line x1="86" y1="110" x2="90" y2="172" stroke="#1c1714" stroke-width="2"/>',
  torii:
    bg("skyDusk") +
    moon(58, 46) +
    '<path d="M0 160 L300 152 L300 206 L0 206Z" fill="#241f26"/>' +
    '<g fill="#15101a"><rect x="200" y="78" width="11" height="86"/><rect x="250" y="78" width="11" height="86"/>' +
    '<rect x="190" y="74" width="82" height="9"/><rect x="196" y="90" width="70" height="6"/><rect x="231" y="83" width="11" height="11"/></g>' +
    '<g stroke="#3a3440" stroke-width="1" opacity=".4"><line x1="190" y1="182" x2="272" y2="182"/><line x1="200" y1="192" x2="262" y2="192"/></g>',
  crane:
    bg("skyNight") +
    moon(150, 44) +
    '<path d="M58 42 C78 34 96 38 110 32 C102 42 86 46 76 44 C90 48 106 44 118 48 C102 54 82 52 68 48Z" fill="#0c1116"/>' +
    '<path d="M196 60 C210 54 224 57 234 52 C228 60 216 63 208 61 C218 65 230 62 240 65 C228 70 212 68 202 65Z" fill="#0c1116" opacity=".8"/>' +
    '<g stroke="#1c242c" stroke-width="2"><line x1="18" y1="206" x2="14" y2="158"/><line x1="28" y1="206" x2="32" y2="164"/><line x1="40" y1="206" x2="36" y2="168"/></g>' +
    '<path d="M0 182 L300 172 L300 206 L0 206Z" fill="#141b22"/>',
};

/** Shared gradient/filter defs from card-pack-v2.html — rendered once globally. */
export function SceneDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="skyNight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0E141B" />
          <stop offset=".55" stopColor="#141A21" />
          <stop offset="1" stopColor="#1a222a" />
        </linearGradient>
        <linearGradient id="skyDusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#221d29" />
          <stop offset=".5" stopColor="#3a323e" />
          <stop offset="1" stopColor="#564b54" />
        </linearGradient>
        <linearGradient id="skyDawn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#383631" />
          <stop offset=".5" stopColor="#6e655d" />
          <stop offset="1" stopColor="#a99c8c" />
        </linearGradient>
        <linearGradient id="skyDay" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7e8891" />
          <stop offset=".5" stopColor="#9aa3aa" />
          <stop offset="1" stopColor="#c0c6c9" />
        </linearGradient>
        <linearGradient id="skyFog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#565d63" />
          <stop offset=".5" stopColor="#767d82" />
          <stop offset="1" stopColor="#969ba0" />
        </linearGradient>
        <radialGradient id="moong" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#cdd3cb" stopOpacity=".85" />
          <stop offset=".6" stopColor="#cdd3cb" stopOpacity=".1" />
          <stop offset="1" stopColor="#cdd3cb" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sung" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#e6e0d2" stopOpacity=".7" />
          <stop offset=".6" stopColor="#e6e0d2" stopOpacity=".1" />
          <stop offset="1" stopColor="#e6e0d2" stopOpacity="0" />
        </radialGradient>
        <filter id="blur">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
    </svg>
  );
}

export function CardScene({ scene }: { scene: string }) {
  const markup = SCENES[scene] ?? SCENES.fujiNight!;
  return (
    <svg
      className="scene"
      viewBox="0 0 300 206"
      preserveAspectRatio="xMidYMid slice"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
