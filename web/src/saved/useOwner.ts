"use client";
/**
 * Whether this browser owns a shared route (blueprint Phase 5c amendment 9). The page is rendered without a token,
 * so the browser asks again with the one it already has. With none it asks nothing: a visitor never gets a session.
 */
import { useEffect, useState } from "react";
import { TOKEN_KEY } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";
import { listSaved, type SavedRow } from "./api";

/** The owner's saved route behind this slug (its saved_id is not in the public response), else null. */
export function useOwner(slug: string) {
  const [owned, setOwned] = useState<SavedRow | null>(null);
  useEffect(() => {
    let token: string | null = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch {
      /* no storage, so no saved routes of its own */
    }
    if (!token) return;
    const header = { "X-Client-Token": token };
    let live = true;
    (async () => {
      const client = planClient();
      const { data } = await client.api.GET("/v1/share/{slug}", { params: { path: { slug } }, headers: header, cache: "no-store" });
      if (!data?.is_owner) return;
      const row = (await listSaved(client)).find((r) => r.share_slug === slug);
      if (live && row) setOwned(row);
    })().catch(() => {
      /* offline: the page is a visitor's, which is all it can promise */
    });
    return () => { live = false; };
  }, [slug]);
  return [owned, setOwned] as const;
}
