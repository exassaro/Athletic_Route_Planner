/**
 * Grouping for the place picker (Phase 5 amendment 8): OSM often holds one place several times (village node,
 * boundary, station). Results with the same name and the same county are one group; the user still picks the
 * member. No distance is involved.
 */
import type { Schemas } from "@/api/client";

export type Place = Schemas["PlaceOut"];
export type PlaceGroup = { key: string; label: string; county: string | null; members: Place[] };

const KIND_ORDER = ["place=", "boundary=", "railway=", "highway=", "amenity="];

export function kindName(kind: string): string {
  const [key, value] = kind.split("=");
  if (!value) return kind;
  if (key === "boundary") return "Boundary";
  if (key === "railway") return value === "station" ? "Railway station" : "Railway";
  if (key === "place") return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
  if (key === "highway") return "Road";
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

function rank(p: Place): number {
  const i = KIND_ORDER.findIndex((k) => p.kind.startsWith(k));
  return i < 0 ? KIND_ORDER.length : i;
}

export function groupPlaces(places: Place[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const p of places) {
    const key = `${p.label.toLowerCase()}|${(p.county ?? "").toLowerCase()}`;
    const g = groups.get(key) ?? { key, label: p.label, county: p.county ?? null, members: [] };
    g.members.push(p);
    groups.set(key, g);
  }
  // Groups keep Photon's order (first appearance); members put the place itself first.
  return [...groups.values()].map((g) => ({ ...g, members: [...g.members].sort((a, b) => rank(a) - rank(b)) }));
}
