"use client";
/** Saved routes of this browser's client (section 13): open the share page, rename, download GPX. No delete yet. */
import { useCallback, useEffect, useState } from "react";
import type { Schemas } from "@/api/client";
import { Sprite } from "@/components/Sprite";
import { StatNumber } from "@/components/StatNumber";
import { Button } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { OpenIn } from "@/components/OpenIn";
import { ownRouteGpx, ownRoutePoints } from "@/export/ownRoute";
import { downloadGpx, shareUrl } from "@/components/SaveShare";
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
      <h1 className="t-title">Saved routes</h1>
      <p><Link href="/">Plan a run</Link></p>
      {msg && <p role="status">{msg}</p>}
      {routes === null && <p className="muted">Loading…</p>}
      {routes?.length === 0 && <p className="muted">Nothing saved on this device yet.</p>}
      <ul className="saved-list">
        {routes?.map((r) => (
          <li key={r.saved_id} className="saved-card">
            {/* the thumbnail stays still (amendment 6); the route it opens hops three times (amendment 13) */}
            <span className="saved-thumb"><Sprite name="sneaker" scale={2} /></span>
            <div className="saved-text">
              <h2 className="t-heading">{r.name ?? "Unnamed run"}</h2>
              <p className="saved-line"><StatNumber kind="km" value={r.foot_m} field="foot_m" size="m" />
                <span className="t-body-s muted"> · ends at {r.end_label ?? "an unnamed road"}</span></p>
              <div className="saved-actions">
                <a className="btn btn-secondary" href={shareUrl(r.share_slug)}>Open</a>
                <OpenIn loadPoints={() => ownRoutePoints(r.route_id)} loadGpx={(ele) => ownRouteGpx(r.route_id, ele)} />
                <Button icon="edit" onClick={() => rename(r)}>Rename</Button>
                <Button icon="download" onClick={() => downloadGpx(r.route_id, true).catch((e) => setMsg(String(e.message)))}>GPX</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
