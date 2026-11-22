/**
 * What the planner keeps for this tab, so a refresh or Back does not lose it (blueprint Phase 5e amendments 1
 * and 2): sessionStorage, `gatho:draft:v1`. A computed plan is only a pointer, read again from the API.
 *
 * Never stored: geometry (a stop's boundary, a road's lines), a GPS position (a start taken from "My location",
 * and the map's view then) or a token. Stops are kept by their OSM ids and built again by the API before planning.
 * Reading never throws: anything unexpected is a clean start.
 */
import type { NewRouteRequest, Schemas } from "@/api/client";
import type { ListName, Point } from "@/plan/edits";
import type { Snap } from "@/components/sheet/BottomSheet";
import type { ChipKey } from "@/components/PlanChips";

export const DRAFT_KEY = "gatho:draft:v1";
export const MAX_AGE_MS = 12 * 3600_000;
/** The label the planner gives a start taken from the browser's location: that is how such a start is known. */
export const MY_LOCATION = "My location";
const SCHEMA = 1;
const LISTS: ListName[] = ["checkpoints", "via", "must_use", "avoid"];

/** The planner's draft: a new request whose start may still be missing. */
export type Draft = Omit<NewRouteRequest, "start"> & { start: Point | null };

export type RunPointer = {
  plan: string;
  version: number;
  seq: number;
  /** The saved route being edited. */
  edit: string | null;
  history: { versions: number[]; at: number };
};

export type View = { center: [number, number]; zoom: number };

export type Stored = {
  schema: number;
  at: number;
  run: RunPointer | null;
  draft: Draft;
  /** The start was the runner's location, which is not kept. */
  located: boolean;
  step: number;
  sheet: Snap;
  editor: ChipKey | null;
  view: View | null;
};

const fromLocation = (point: Point | null | undefined) => !!point && point.label === MY_LOCATION && !point.place_id;

type Item = Record<string, unknown>;

/** An item without its geometry: a road or bridge keeps its first way's id, which the API expands again. */
function lite({ boundary: _b, polygon: _p, lines: _l, way_ids, ...item }: Item): Item {
  const first = (way_ids as number[] | undefined)?.[0];
  return first === undefined ? item : { ...item, way_ids: [first] };
}

/** What may be stored of a request or draft. */
export function storable(request: Draft): { draft: Draft; located: boolean } {
  const located = fromLocation(request.start);
  const out: Item = { ...request, start: located ? null : request.start };
  for (const list of LISTS) {
    const items = out[list] as Item[] | null | undefined;
    if (!items) continue;
    if (items.length) out[list] = items.map(lite);
    else delete out[list];
  }
  return { draft: out as unknown as Draft, located };
}

/** The text to store. The view is left out when the start was the runner's location: it is centred on it. */
export function serialise(state: Omit<Stored, "schema" | "at">, now: number): string {
  const stripped = storable(state.draft);
  const { draft } = stripped;
  const located = stripped.located || (state.located && !draft.start);      // also when it was left out last time
  const stored: Stored = { ...state, schema: SCHEMA, at: now, draft, located, view: located ? null : state.view };
  return JSON.stringify(stored);
}

/** The stored state, or null for none, too old, another schema or anything unreadable. */
export function parseStored(text: string | null, now: number): Stored | null {
  if (!text) return null;
  try {
    const s = JSON.parse(text) as Stored;
    if (s.schema !== SCHEMA || !(now - s.at < MAX_AGE_MS)) return null;
    const d = s.draft;
    if (!(d.target_distance_m > 0) || !["point_to_point", "out_and_back", "loop"].includes(d.route_type)) return null;
    if (d.start && !(Number.isFinite(d.start.lon) && Number.isFinite(d.start.lat))) return null;
    if (LISTS.some((list) => d[list] != null && !Array.isArray(d[list]))) return null;
    if (![1, 2, 3, 4, 5].includes(s.step) || !["peek", "half", "full"].includes(s.sheet)) return null;
    const r = s.run;
    if (r && !(typeof r.plan === "string" && r.version >= 1 && Array.isArray(r.history.versions))) return null;
    const v = s.view;
    if (v && !(Number.isFinite(v.center[0]) && Number.isFinite(v.center[1]) && Number.isFinite(v.zoom))) return null;
    return s;
  } catch {
    return null;
  }
}

type FetchItem = (role: "checkpoint" | "via" | "must_use" | "avoid", kind: "place" | "bridge" | "road", placeId: string,
  place?: { lon: number; lat: number; label: string }, mustReach?: boolean, label?: string) => Promise<Schemas["FeatureItemOut"]>;

const ROLE = { checkpoints: "checkpoint", via: "via", must_use: "must_use", avoid: "avoid" } as const;

/** A stored draft's items as the API builds them, boundaries and lines included. Reads only: it never solves. */
export async function rebuildItems(draft: Draft, fetchItem: FetchItem): Promise<Draft> {
  const out: Item = { ...draft };
  for (const list of LISTS) {
    const items = out[list] as Item[] | null | undefined;
    if (!items?.length) continue;
    const role = ROLE[list];
    out[list] = await Promise.all(items.map(async (item) => {
      const kind = (item.kind ?? "place") as string;
      const label = (item.label ?? undefined) as string | undefined;
      const id = item.place_id as string | null | undefined;
      const way = (item.way_ids as number[] | undefined)?.[0];
      let built: Schemas["FeatureItemOut"];
      if (kind === "bridge" || kind === "road") {
        const placeId = id?.startsWith("osm:way/") ? id : `osm:way/${way}`;
        built = await fetchItem(role, kind, placeId, undefined, !!item.must_reach, label);
      } else if (list === "checkpoints" && kind === "place" && id?.startsWith("osm:") && label) {
        built = await fetchItem(role, kind, id, { lon: item.lon as number, lat: item.lat as number, label }, !!item.must_reach);
      } else {
        return item;        // a point or a circle: there was no geometry to leave out
      }
      return built[role] as unknown as Item;
    }));
  }
  return out as unknown as Draft;
}
