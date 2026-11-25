/**
 * Which map a plan was made on, compared with the engines' map now (Phase 5e: "Built on an older map").
 *
 * Since Step 9 the public /v1/health gives no build ids, only an opaque id of each: the first 16 hex characters of
 * the sha256 of the build id. A plan version still carries its build ids, so they are hashed here the same way.
 * Without WebCrypto (an http page that is not localhost) there is no comparison, and so no note.
 */
import type { Schemas } from "@/api/client";

export type MapIds = Schemas["MapIds"];
type Builds = Schemas["BuildsOut"];
const KEYS = ["osm", "valhalla", "graphhopper"] as const;

async function sha16(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The map ids of a plan version's builds, or null when this page cannot hash. */
export async function mapIdsOf(builds: Builds): Promise<MapIds | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const ids = await Promise.all(KEYS.map((k) => (builds[k] ? sha16(builds[k]!) : Promise.resolve(null))));
  return { osm: ids[0] ?? null, valhalla: ids[1] ?? null, graphhopper: ids[2] ?? null };
}

/** Whether any engine's map changed. An engine that is down (null) is not another map. */
export function olderMap(made: MapIds | null, now: MapIds | null): boolean {
  if (!made || !now) return false;
  return KEYS.some((k) => !!made[k] && !!now[k] && made[k] !== now[k]);
}
