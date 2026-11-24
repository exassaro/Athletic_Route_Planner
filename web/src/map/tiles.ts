/**
 * Loading the basemap's PMTiles (blueprint Phase 5b amendment 12).
 *
 * Every Range request bypasses the browser cache. Chrome on Windows can return zero-filled bodies for cached Range
 * responses once overlapping requests have been aborted ("Wrong magic number for PMTiles archive"). pmtiles works
 * around it only when the user agent contains "Windows", which device emulation removes, so it is forced here. The
 * server also sends no-store (next.config.ts, or the basemap's own server when it is on another origin: web/README.md,
 * "Split origin"); no-cache does not prevent the bug.
 */
import { FetchSource, PMTiles } from "pmtiles";
import type { ErrorEvent, Map as MapLibreMap } from "maplibre-gl";
import { BASEMAP_SOURCE } from "./basemap";

export const RETRY_MS = 500;

export function basemapArchive(url: string): PMTiles {
  const source = new FetchSource(url);
  source.chromeWindowsNoCache = true; // pmtiles' own switch for `cache: "no-store"`, whatever the user agent says
  return new PMTiles(source);
}

/**
 * One automatic retry when the basemap fails, then `onFailed(true)`. `retry` is the "Reload map" button. Errors are
 * still logged: MapLibre stops logging them itself once something listens for them.
 */
export function watchBasemap(map: Pick<MapLibreMap, "on" | "off">, refetch: () => void, onFailed: (failed: boolean) => void) {
  let retried = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onError = (e: ErrorEvent) => {
    console.error(e.error);
    if ((e as ErrorEvent & { sourceId?: string }).sourceId !== BASEMAP_SOURCE || timer) return;
    if (retried) return onFailed(true);
    retried = true;
    timer = setTimeout(() => {
      timer = null;
      refetch();
    }, RETRY_MS);
  };
  map.on("error", onError);
  return {
    retry() {
      onFailed(false);
      refetch();
    },
    stop() {
      if (timer) clearTimeout(timer);
      map.off("error", onError);
    },
  };
}
