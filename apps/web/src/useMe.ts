import { useEffect, useState } from "react";
import { API_HTTP } from "./api";

export interface Me {
  login: string;
  avatarUrl: string;
}

/** Asks the API who this browser is (session cookie set during GitHub login). */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch(`${API_HTTP}/me`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: { login?: string | null; avatarUrl?: string }) => {
        if (d?.login) setMe({ login: d.login, avatarUrl: d.avatarUrl ?? "" });
      })
      .catch(() => {});
  }, []);
  return me;
}
