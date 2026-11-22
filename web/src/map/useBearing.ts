/** The map's bearing (what is at the top of the screen), followed as it turns. 0 until there is a map. */
import { useCallback, useSyncExternalStore } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";

export function useBearing(map: MapLibreMap | null): number {
  const subscribe = useCallback((changed: () => void) => {
    map?.on("rotate", changed);
    return () => { map?.off("rotate", changed); };
  }, [map]);
  return useSyncExternalStore(subscribe, () => map?.getBearing() ?? 0, () => 0);
}
