/** The opaque map ids (Step 9): hashed like the API's, and only a real change is an older map. */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapIdsOf, olderMap } from "./mapIds";

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

describe("map ids", () => {
  it("are the first 16 hex of the sha256 of each build id, as the API makes them", async () => {
    const builds = { osm: "2026-11-15T00:15:25Z", valhalla: "valhalla 3.9.2 tiles x", graphhopper: null } as never;
    expect(await mapIdsOf(builds)).toEqual({ osm: sha16("2026-11-15T00:15:25Z"), valhalla: sha16("valhalla 3.9.2 tiles x"),
      graphhopper: null });
  });

  it("an older map is a changed id; an engine that is down is not", () => {
    const made = { osm: "a", valhalla: "b", graphhopper: "c" };
    expect(olderMap(made, { ...made })).toBe(false);
    expect(olderMap(made, { ...made, valhalla: "z" })).toBe(true);
    expect(olderMap(made, { ...made, graphhopper: null })).toBe(false);
    expect(olderMap(null, made)).toBe(false);
    expect(olderMap(made, null)).toBe(false);
  });
});
