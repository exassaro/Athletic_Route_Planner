"use client";
/**
 * Save (and rename), share link, GPX download (section 13 "Keep"). Saving again renames and keeps the link
 * (Phase 4 choice 9). The GPX needs the client token, so it is fetched and handed to the browser as a file;
 * the runner can leave the elevation out (Phase 5 A2) so the importing app uses its own.
 * While a saved route is edited its own control takes the place of Save (EditingSave, Phase 5c).
 */
import { useEffect, useState, type ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { saveFile } from "@/export/gpxFile";
import { ownRouteGpx, ownRouteOverview, ownRoutePoints } from "@/export/ownRoute";
import { planClient } from "@/plan/usePlan";
import { saveRoute } from "@/saved/api";
import { NAME_MAX } from "@/saved/name";
import { shareUrl } from "@/saved/share";
import { OpenIn } from "./OpenIn";

type Candidate = Schemas["CandidateOut"];

export async function downloadGpx(routeId: string, ele: boolean) {
  saveFile(await ownRouteGpx(routeId, ele));
}

export function SaveShare({ cand, control }: { cand: Candidate; control?: ReactNode }) {
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<Schemas["SavedOut"] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setSaved(null); // eslint-disable-line react-hooks/set-state-in-effect
    setMsg(null);
  }, [cand.route_id]);

  const save = async () => {
    try {
      setSaved(await saveRoute(planClient(), cand.route_id, name.trim() || null));
      setMsg(saved ? "Renamed." : "Saved.");
    } catch {
      setMsg("Could not save. Try again.");
    }
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
      {control ?? <>
      <div className="row">
        <label htmlFor="route-name" className="sr-only">Name</label>
        <input id="route-name" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX} data-testid="route-name" />
        <button type="button" onClick={save} data-testid="save">{saved ? "Rename" : "Save"}</button>
      </div>
      {saved && (
        <p className="share">
          <a href={shareUrl(saved.share_slug)} target="_blank" rel="noreferrer" data-testid="share-link">{shareUrl(saved.share_slug)}</a>
          <button type="button" onClick={copy}>Copy link</button>
        </p>
      )}
      </>}
      <div className="row">
        <OpenIn footM={cand.foot_m} loadPoints={() => ownRoutePoints(cand.route_id)}
          loadOverview={(max) => ownRouteOverview(cand.route_id, max)} loadGpx={(ele) => ownRouteGpx(cand.route_id, ele)} />
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
