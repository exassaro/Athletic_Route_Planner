"use client";
/**
 * The contents of "Open in..." (blueprint Phase 5d amendments 1 to 3), loaded when the sheet opens: the GPX first,
 * because it is the exact route; Google Maps as an overview; how to get the exact line into My Maps; Garmin and
 * Strava as notes. It offers only what works: no Garmin button (there is no link or API for it) and no Strava
 * upload link (Strava rejects files without timestamps as activities, and a course has none).
 *
 * The Google link works at once with evenly spaced km marks and takes the API's overview points when they arrive,
 * so a tap never waits for them. Without them there is no estimate, and no error: the link still works.
 */
import { useEffect, useState } from "react";
import { googleMapsUrl, thisDevice, waypointLimit, type Overview, type RoutePoints } from "@/export/googleMaps";
import { saveFile, SHARE_MESSAGE, shareOrSave } from "@/export/gpxFile";
import { km } from "@/plan/format";
import { Num } from "./Num";
import type { OpenInProps } from "./OpenIn";
import { Button, Icon } from "./ui";

// Garmin: "Importing a Third-Party Course into Garmin Connect". Its steps could not be read (the site refuses
// automated fetches), so they are linked and not repeated here.
export const GARMIN_HELP = "https://support.garmin.com/en-US/?faq=wKuZXCaZRP4mWPX5aRz5h5";
// Strava: "How Do I Create a Route From a GPX File?"
export const STRAVA_HELP = "https://support.strava.com/en-us/articles/15402061-how-do-i-create-a-route-from-a-gpx-file";
// Google: "Import map features from a file - Computer" (the steps below; read 2026-11-22). Its Android and iOS tabs
// say My Maps isn't available there.
export const MY_MAPS_HELP = "https://support.google.com/mymaps/answer/3024836";

/** Our router's estimate, so it never claims more than "over 95%". Up to that it is rounded down, as the API does. */
const OVERLAP_CAP = 95;
const overlapText = (value: number) => (value > OVERLAP_CAP ? `over ${OVERLAP_CAP}%` : `${Math.floor(value)}%`);

/** Mounted only while the sheet is open, so everything is fetched fresh for the route it was opened on. */
export default function OpenInOptions({ footM, loadPoints, loadOverview, loadGpx }: OpenInProps) {
  const [limit] = useState(() => waypointLimit(thisDevice()));
  const [route, setRoute] = useState<RoutePoints | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [gpx, setGpx] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadPoints().then((p) => { if (live) setRoute(p); }, (e: Error) => { if (live) setMapsError(e.message); });
    loadOverview(limit).then((o) => { if (live) setOverview(o); }, () => { /* evenly spaced points, no estimate */ });
    // before the tap: navigator.share must run inside it, with no wait for the network
    loadGpx(true).then((f) => { if (live) setGpx(f); }, (e: Error) => { if (live) setGpxError(e.message); });
    return () => { live = false; };
    // the loaders are new functions on every render of the caller; the route cannot change while the sheet is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the estimate is of exactly these points, so the two are only ever used together
  const smart = overview && overview.points.length <= limit ? overview : null;

  return (
    <div className="open-in">
      <section className="open-in-group" aria-label="GPX file">
        <Button variant="primary" block icon="share" disabled={!gpx} data-testid="open-share"
          onClick={() => gpx && shareOrSave(gpx).then((r) => setMessage(SHARE_MESSAGE[r]))}>
          Get GPX (exact route)
        </Button>
        <p className="t-body-s" data-testid="open-gpx-note">
          Open it in Organic Maps or OsmAnd (free, offline maps) to see the exact line.
        </p>
        {message && <p role="status" className="t-body-s open-in-message" data-testid="open-message">{message}</p>}
        {gpxError && <p role="alert" className="error-text">{gpxError}</p>}
        <Button block icon="download" disabled={!gpx} data-testid="open-download" onClick={() => gpx && saveFile(gpx)}>
          Download GPX
        </Button>
        <Button variant="quiet" onClick={() => loadGpx(false).then(saveFile, (e: Error) => setGpxError(e.message))}>
          GPX without elevation
        </Button>
      </section>

      <section className="open-in-group" aria-label="Google Maps">
        {route ? (
          <a className="btn btn-secondary btn-block" href={googleMapsUrl(route, limit, smart?.points)} target="_blank"
            rel="noopener noreferrer" data-testid="open-google" data-points={smart ? "smart" : "even"}>
            <Icon name="map" />Google Maps (overview)
          </a>
        ) : (
          <Button block icon="map" disabled>Google Maps (overview)</Button>
        )}
        <p className="t-body-s muted" data-testid="open-google-note">
          Google may re-route between points, so the path and distance can differ. Our route:{" "}
          <Num value={footM} format={(v) => km(v)} field="foot_m" />.
          {smart && (
            <>
              {" "}Estimated overlap: <Num value={smart.overlap_pct} format={overlapText} field="overlap_pct" />{" "}
              (tested with our router, not Google).
            </>
          )}
        </p>
        {mapsError && <p role="alert" className="error-text">{mapsError}</p>}
      </section>

      <section className="open-in-group" aria-label="The exact line in Google Maps">
        <details className="open-in-steps" data-testid="open-mymaps">
          <summary>How to see the exact line in Google Maps</summary>
          <p className="t-body-s">
            This needs a computer: Google My Maps isn&apos;t available on Android, iPhone or iPad.
          </p>
          <ol className="t-body-s">
            <li>Download the GPX and have it on the computer.</li>
            <li>
              On the computer, sign in to{" "}
              <a href="https://www.google.com/maps/d/" target="_blank" rel="noopener noreferrer">My Maps</a>.
            </li>
            <li>Open or create a map.</li>
            <li>In the map legend, click <strong>Add layer</strong>, and give the layer a name.</li>
            <li>Under the new layer, click <strong>Import</strong>.</li>
            <li>Upload the GPX file, then click <strong>Select</strong>.</li>
          </ol>
          <p className="t-body-s">
            <a href={MY_MAPS_HELP} target="_blank" rel="noopener noreferrer" data-testid="open-mymaps-help">How to import into My Maps</a>{" "}
            (Google&apos;s help).
          </p>
        </details>
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
