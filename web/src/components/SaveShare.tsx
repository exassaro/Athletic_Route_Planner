"use client";
/**
 * Save (and rename), share link, GPX download (section 13 "Keep"). Saving again renames and keeps the link
 * (Phase 4 choice 9). The GPX needs the client token, so it is fetched and handed to the browser as a file;
 * the runner can leave the elevation out (Phase 5 A2) so the importing app uses its own.
 */
import { useEffect, useState } from "react";
import type { Schemas } from "@/api/client";
import { planClient } from "@/plan/usePlan";

type Candidate = Schemas["CandidateOut"];

export function shareUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`;
}

export async function downloadGpx(routeId: string, ele: boolean) {
  const client = planClient();
  const { data, response } = await client.api.GET("/v1/routes/{route_id}/gpx", {
    params: { path: { route_id: routeId }, query: { ele } }, parseAs: "blob" });
  if (!data) throw new Error(`GPX download failed (${response.status}).`);
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "route.gpx";
  const url = URL.createObjectURL(data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function SaveShare({ cand }: { cand: Candidate }) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<Schemas["SavedOut"] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setSaved(null); // eslint-disable-line react-hooks/set-state-in-effect
    setMsg(null);
  }, [cand.route_id]);

  const save = async () => {
    const { data, error } = await planClient().api.POST("/v1/routes/{route_id}/save", {
      params: { path: { route_id: cand.route_id } }, body: { name: name.trim() || null } });
    if (!data) return setMsg((error as { message?: string } | undefined)?.message ?? "Could not save.");
    setSaved(data);
    setMsg(saved ? "Renamed." : "Saved.");
  };
  const copy = async () => {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(shareUrl(saved.share_slug));
      setMsg("Link copied.");
    } catch {
      setMsg("Copy the link above.");
    }
  };

  return (
    <section className="keep" aria-label="Save and share">
      <h2>Keep this route</h2>
      <div className="row">
        <label htmlFor="route-name" className="sr-only">Name</label>
        <input id="route-name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)}
          maxLength={200} data-testid="route-name" />
        <button type="button" onClick={save} data-testid="save">{saved ? "Rename" : "Save"}</button>
      </div>
      {saved && (
        <p className="share">
          <a href={shareUrl(saved.share_slug)} target="_blank" rel="noreferrer" data-testid="share-link">{shareUrl(saved.share_slug)}</a>
          <button type="button" onClick={copy}>Copy link</button>
        </p>
      )}
      <div className="row">
        <button type="button" onClick={() => downloadGpx(cand.route_id, true).catch((e) => setMsg(String(e.message)))}
          data-testid="gpx">Download GPX</button>
        <button type="button" className="link" onClick={() => downloadGpx(cand.route_id, false).catch((e) => setMsg(String(e.message)))}>
          GPX without elevation
        </button>
      </div>
      {msg && <p role="status" className="muted">{msg}</p>}
    </section>
  );
}
