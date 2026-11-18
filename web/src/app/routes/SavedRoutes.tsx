"use client";
/** Saved routes of this browser's client (section 13): open the share page, rename, download GPX. No delete yet. */
import { useCallback, useEffect, useState } from "react";
import type { Schemas } from "@/api/client";
import { Num } from "@/components/Num";
import { Wordmark } from "@/components/Wordmark";
import { downloadGpx, shareUrl } from "@/components/SaveShare";
import { km } from "@/plan/format";
import { planClient } from "@/plan/usePlan";
import Link from "next/link";

type Saved = Schemas["SavedRouteOut"];

export function SavedRoutes() {
  const [routes, setRoutes] = useState<Saved[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => planClient().api.GET("/v1/me/routes")
    .then(({ data }) => setRoutes((data as Saved[] | undefined) ?? [])), []);
  useEffect(() => {
    load();
  }, [load]);
  const rename = async (r: Saved) => {
    const name = window.prompt("New name", r.name ?? "");
    if (name === null) return;
    const { data } = await planClient().api.POST("/v1/routes/{route_id}/save", {
      params: { path: { route_id: r.route_id } }, body: { name: name.trim() || null } });
    setMsg(data ? "Renamed." : "Could not rename.");
    await load();
  };
  return (
    <main className="saved-page">
      <p className="brand-row"><Link href="/" aria-label="GATHO: plan a run"><Wordmark /></Link></p>
      <h1>Saved routes</h1>
      <p><Link href="/">Plan a run</Link></p>
      {msg && <p role="status">{msg}</p>}
      {routes === null && <p className="muted">Loading…</p>}
      {routes?.length === 0 && <p className="muted">Nothing saved on this device yet.</p>}
      <ul className="saved-list">
        {routes?.map((r) => (
          <li key={r.saved_id} className="card">
            <h2>{r.name ?? "Unnamed run"}</h2>
            <p><Num value={r.foot_m} format={(m) => km(m)} field="foot_m" /> · ends at {r.end_label ?? "an unnamed road"}</p>
            <p className="row">
              <a href={shareUrl(r.share_slug)}>Open</a>
              <button type="button" onClick={() => rename(r)}>Rename</button>
              <button type="button" onClick={() => downloadGpx(r.route_id, true).catch((e) => setMsg(String(e.message)))}>GPX</button>
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
