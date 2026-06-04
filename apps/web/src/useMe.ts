import { useEffect, useState } from "react";
import { API_HTTP } from "./api";

export interface Me {
  login: string;
  avatarUrl: string;
  /** CLI still on the claude-only build — show the re-install nudge. */
  outdatedClient?: boolean;
  /** Plausibility-flagged — stats hidden from boards pending review. */
  underReview?: boolean;
}

/** Asks the API who this browser is (session cookie set during GitHub login). */
export function useMe(): { me: Me | null; resolved: boolean } {
  const [me, setMe] = useState<Me | null>(null);
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    fetch(`${API_HTTP}/me`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { login?: string | null; avatarUrl?: string; outdatedClient?: boolean; underReview?: boolean }) => {
        if (d?.login) {
          setMe({
            login: d.login,
            avatarUrl: d.avatarUrl ?? "",
            outdatedClient: d.outdatedClient === true,
            underReview: d.underReview === true,
          });
        }
      })
      .catch(() => {})
      .finally(() => setResolved(true));
  }, []);
  return { me, resolved };
}
