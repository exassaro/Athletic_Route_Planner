import { describe, expect, it } from "vitest";
import { groupPlaces, kindName, type Place } from "./places";

const p = (label: string, kind: string, county: string | null, id: string): Place =>
  ({ place_id: id, label, kind, county, city: null, street: null, state: "Kerala", lon: 75.8, lat: 11.1 });

describe("place picker groups", () => {
  it("groups the same name in the same county, keeps other counties apart, place first", () => {
    const groups = groupPlaces([
      p("Kadalundi", "railway=station", "Kozhikode", "osm:node/1"),
      p("Kadalundi", "place=village", "Kozhikode", "osm:node/2"),
      p("Kadalundi", "boundary=administrative", "Kozhikode", "osm:relation/3"),
      p("Kadalundi", "place=village", "Malappuram", "osm:node/4"),
    ]);
    expect(groups.map((g) => [g.label, g.county, g.members.map((m) => m.place_id)])).toEqual([
      ["Kadalundi", "Kozhikode", ["osm:node/2", "osm:relation/3", "osm:node/1"]],
      ["Kadalundi", "Malappuram", ["osm:node/4"]],
    ]);
    expect(groups[0]!.members.map((m) => kindName(m.kind))).toEqual(["Village", "Boundary", "Railway station"]);
  });
});
