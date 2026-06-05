import { useEffect, useState } from "react";
import { API_HTTP } from "../../api";
import { Avatar } from "../Avatar";
import { PixelSword } from "./PixelSword";

// The server's fallback for nameless donors — gets the pixel sword treatment.
const ANON_NAME = "anon warrior";

interface WallEntry {
  name: string;
  avatarUrl: string;
}

// sponsorkit JSON entry (GitHub Sponsors side, static /sponsors.json).
interface SponsorkitEntry {
  sponsor: { name?: string; login: string; avatarUrl?: string };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    // The static /sponsors.json 404s as index.html on dev servers — guard on type.
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GitHub sponsors (static sponsorkit JSON) + Razorpay donors (API), merged.
 *  Silent on failure; `refreshKey` bumps refetch after a successful donation. */
export function SponsorsWall({ refreshKey }: { refreshKey: number }) {
  const [entries, setEntries] = useState<WallEntry[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchJson<SponsorkitEntry[]>("/sponsors.json"),
      fetchJson<{ name: string }[]>(`${API_HTTP}/sponsors`),
    ]).then(([github, donors]) => {
      if (!alive) return;
      const gh = (github ?? []).map((e) => ({
        name: e.sponsor.name ?? e.sponsor.login,
        avatarUrl: e.sponsor.avatarUrl ?? "",
      }));
      const rzp = (donors ?? []).map((d) => ({ name: d.name, avatarUrl: "" }));
      setEntries([...rzp, ...gh]);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (entries.length === 0) {
    return <div className="wall-empty">Be the first warrior to back the board.</div>;
  }

  return (
    <div className="wall" aria-label="Sponsors">
      {entries.map((e, i) => (
        <div className="wall-item" key={`${e.name}-${i}`} title={e.name}>
          {e.name === ANON_NAME ? (
            <span className="av wall-av wall-anon">
              <PixelSword />
            </span>
          ) : (
            <Avatar src={e.avatarUrl} name={e.name} index={i} className="av wall-av" />
          )}
          <span className="wall-name">{e.name}</span>
        </div>
      ))}
    </div>
  );
}
