import { useEffect, useRef } from "react";

const NS = "http://www.w3.org/2000/svg";

/**
 * Ported 1:1 from buildClawd(svg) in full-page-v3.html.
 * Builds the pixel Clawd warrior (with sword + shield) as <rect> nodes once.
 */
function buildClawd(svg: SVGSVGElement) {
  const OR = "#CC785C",
    BL = "#9aa6b3",
    BH = "#dfe6ec",
    ST = "#3f4854",
    GR = "#74471f",
    SH = "#aeb7c2",
    RM = "#434b56",
    CELL = 7,
    OX = 60,
    OY = 24;
  function px(c: number, r: number, col: string) {
    const x = document.createElementNS(NS, "rect");
    x.setAttribute("x", String(OX + c * CELL));
    x.setAttribute("y", String(OY + r * CELL));
    x.setAttribute("width", String(CELL + 0.4));
    x.setAttribute("height", String(CELL + 0.4));
    x.setAttribute("fill", col);
    svg.appendChild(x);
  }
  function eye(c: number, r: number) {
    return (((c === 4 || c === 5) && r >= 4 && r <= 7) || ((c === 18 || c === 19) && r >= 4 && r <= 7));
  }
  for (let c = 0; c <= 23; c++) for (let r = 0; r <= 15; r++) if (!eye(c, r)) px(c, r, OR);
  for (let nr = 8; nr <= 11; nr++) {
    px(-2, nr, OR);
    px(-1, nr, OR);
    px(24, nr, OR);
    px(25, nr, OR);
  }
  [
    [4, 5],
    [8, 9],
    [14, 15],
    [18, 19],
  ].forEach((p) => {
    for (let lr = 16; lr <= 19; lr++) {
      px(p[0]!, lr, OR);
      px(p[1]!, lr, OR);
    }
  });
  for (let b = -2; b <= 6; b++) {
    px(26, b, BH);
    px(27, b, BL);
  }
  [25, 26, 27, 28].forEach((g) => {
    px(g, 7, ST);
  });
  for (let gr = 8; gr <= 10; gr++) {
    px(26, gr, GR);
    px(27, gr, GR);
  }
  px(26, 11, ST);
  px(27, 11, ST);
  function s(c: number, r: number, rim: boolean) {
    px(c, r, rim ? RM : SH);
  }
  s(-6, 6, true);
  s(-5, 6, true);
  s(-4, 6, true);
  for (let sr = 7; sr <= 11; sr++) {
    s(-7, sr, true);
    s(-6, sr, false);
    s(-5, sr, false);
    s(-4, sr, false);
    s(-3, sr, true);
  }
  s(-6, 12, true);
  s(-5, 12, false);
  s(-4, 12, true);
  s(-5, 13, true);
  [
    [-5, 8],
    [-6, 9],
    [-5, 9],
    [-4, 9],
    [-5, 10],
  ].forEach((p) => {
    px(p[0]!, p[1]!, OR);
  });
}

export function ClawdLogo({ className }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    svg.replaceChildren();
    buildClawd(svg);
  }, []);
  return <svg ref={ref} className={className} viewBox="0 0 280 210" />;
}
