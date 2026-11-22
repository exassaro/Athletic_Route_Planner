"use client";
/**
 * The pixel compass (blueprint Phase 5b amendment 19), instead of MapLibre's: the needle points to true north as
 * the map turns, and a tap faces the map north. While a direction is being picked it also marks that direction, so
 * "south-east" can be seen on the map as it is turned.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import { useBearing } from "./useBearing";

// 23 x 23 cells, centred on 11.5. The needle is drawn pointing north and turned as a whole.
const NORTH = "M11 4h1v2h-1zM10 6h3v2h-3zM9 8h5v3h-5z";
const SOUTH = "M9 12h5v3h-5zM10 15h3v2h-3zM11 17h1v2h-1z";
const HUB = "M11 11h1v1h-1z";
/** The chosen direction, on the rim: a block with a tip pointing outwards. */
const MARK = "M11 0h1v1h-1zM10 1h3v2h-3z";
const turn = (degrees: number) => `rotate(${degrees} 11.5 11.5)`;

type Props = { map: MapLibreMap | null; pointing?: number | null };

export function Compass({ map, pointing = null }: Props) {
  const bearing = useBearing(map);
  return (
    <button type="button" className="map-compass" aria-label="Compass, tap to face north" title="Compass, tap to face north"
      data-testid="compass" data-bearing={Math.round(bearing)} onClick={() => map?.easeTo({ bearing: 0, pitch: 0 })}>
      <svg width="46" height="46" viewBox="0 0 23 23" shapeRendering="crispEdges" aria-hidden="true">
        <g transform={turn(-bearing)} data-needle="">
          <path className="compass-north" d={NORTH} />
          <path className="compass-south" d={SOUTH} />
        </g>
        <path className="compass-hub" d={HUB} />
        {pointing !== null && (
          <g transform={turn(pointing - bearing)} data-testid="compass-direction">
            <path className="compass-mark" d={MARK} />
          </g>
        )}
      </svg>
    </button>
  );
}
