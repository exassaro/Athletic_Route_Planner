"use client";
/**
 * "Open in..." (blueprint Phase 5b amendment 20): Google Maps, the GPX shared or downloaded, and where Garmin and
 * Strava explain their own imports. It offers only what works: no Garmin button (there is no link or API for it)
 * and no Strava upload link (Strava rejects files without timestamps as activities, and a course has none).
 */
import { useEffect, useState } from "react";
import { googleMapsUrl, waypointLimit, type RoutePoints } from "@/export/googleMaps";
import { saveFile, SHARE_MESSAGE, shareOrSave } from "@/export/gpxFile";
import { EditorDialog } from "./EditorDialog";
import { Button, Icon } from "./ui";

// Garmin: "Importing a Third-Party Course into Garmin Connect". Its steps could not be read (the site refuses
// automated fetches), so they are linked and not repeated here.
export const GARMIN_HELP = "https://support.garmin.com/en-US/?faq=wKuZXCaZRP4mWPX5aRz5h5";
// Strava: "How Do I Create a Route From a GPX File?"
export const STRAVA_HELP = "https://support.strava.com/en-us/articles/15402061-how-do-i-create-a-route-from-a-gpx-file";

type Props = { loadPoints: () => Promise<RoutePoints>; loadGpx: (ele: boolean) => Promise<File> };

export function OpenIn(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="externalLink" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="open-in">Open in…</Button>
      <OpenInDialog open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}

/** The sheet alone, for where something else opens it (a menu). */
export function OpenInDialog({ open, onClose, ...props }: Props & { open: boolean; onClose: () => void }) {
  return (
    <EditorDialog open={open} title="Open in…" onClose={onClose} testId="open-in-sheet">
      <Options {...props} />
    </EditorDialog>
  );
}

/** Mounted only while the sheet is open, so everything is fetched fresh for the route it was opened on. */
function Options({ loadPoints, loadGpx }: Props) {
  const [maps, setMaps] = useState<string | null>(null);
  const [gpx, setGpx] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const failed = (e: unknown) => { if (live) setError(String((e as Error).message)); };
    loadPoints().then((p) => { if (live) setMaps(googleMapsUrl(p, waypointLimit(navigator))); }, failed);
    // before the tap: navigator.share must run inside it, with no wait for the network
    loadGpx(true).then((f) => { if (live) setGpx(f); }, failed);
    return () => { live = false; };
    // the loaders are new functions on every render of the caller; the route cannot change while the sheet is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="open-in">
      <section className="open-in-group" aria-label="Google Maps">
        {maps ? (
          <a className="btn btn-secondary btn-block" href={maps} target="_blank" rel="noopener noreferrer" data-testid="open-google">
            <Icon name="map" />Google Maps (walking)
          </a>
        ) : (
          <Button block icon="map" disabled>Google Maps (walking)</Button>
        )}
        <p className="t-body-s muted">Google Maps may adjust the path between points. Use the GPX for the exact route.</p>
      </section>

      <section className="open-in-group" aria-label="GPX file">
        <Button block icon="share" disabled={!gpx} data-testid="open-share"
          onClick={() => gpx && shareOrSave(gpx).then((r) => setMessage(SHARE_MESSAGE[r]))}>
          Share the GPX file
        </Button>
        <Button block icon="download" disabled={!gpx} data-testid="open-download" onClick={() => gpx && saveFile(gpx)}>
          Download GPX
        </Button>
        <Button variant="quiet" onClick={() => loadGpx(false).then(saveFile, (e: Error) => setError(e.message))}>
          GPX without elevation
        </Button>
        {message && <p role="status" className="t-body-s" data-testid="open-message">{message}</p>}
        {error && <p role="alert" className="error-text">{error}</p>}
      </section>

      <section className="open-in-group" aria-label="Garmin Connect and Strava">
        <p className="t-body-s">
          <strong>Garmin Connect:</strong> GATHO can&apos;t send routes to Garmin. Download the GPX, then follow{" "}
          <a href={GARMIN_HELP} target="_blank" rel="noopener noreferrer" data-testid="open-garmin-help">how to use it in Garmin Connect</a>{" "}
          (Garmin&apos;s help).
        </p>
        <p className="t-body-s">
          <strong>Strava (manual):</strong> Strava needs the GPX downloaded first. It can&apos;t be uploaded as an
          activity, because a planned route has no times. Follow{" "}
          <a href={STRAVA_HELP} target="_blank" rel="noopener noreferrer" data-testid="open-strava-help">how to create a route from a GPX</a>{" "}
          (Strava&apos;s help).
        </p>
      </section>
    </div>
  );
}
