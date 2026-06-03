import { useEffect, useRef } from "react";

const NS = "http://www.w3.org/2000/svg";
const ROWS = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];

/** Ported from the pixel-heart IIFE in full-page-v3.html. */
export function PixelHeart() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const h = ref.current;
    if (!h) return;
    h.replaceChildren();
    ROWS.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === "X") {
          const r = document.createElementNS(NS, "rect");
          r.setAttribute("x", String(x * 2));
          r.setAttribute("y", String(y * 2));
          r.setAttribute("width", "2");
          r.setAttribute("height", "2");
          r.setAttribute("fill", "#E0524D");
          h.appendChild(r);
        }
      }
    });
  }, []);
  return <svg ref={ref} className="ph" viewBox="0 0 14 12" width={13} height={11} />;
}
