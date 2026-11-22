/** "No changes yet" (Phase 5c amendment 2), on the API's own A01 example. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Schemas } from "@/api/client";
import { changed } from "./changed";

const v: Schemas["PlanVersionOut"] = JSON.parse(readFileSync(join(__dirname, "..", "..", "..", "api", "athlete_api", "examples", "plan_A01.json"), "utf8")).value;
const loaded = { request: v.request, route: v.candidates[0]! };

describe("changed", () => {
  it("not when nothing changed, nor when undo made the same route under a new id", () => {
    expect(changed(loaded, v.request, v.candidates[0]!)).toBe(false);
    const undone = { ...v.candidates[0]!, route_id: "00000000-0000-0000-0000-000000000000" };
    const reordered = Object.fromEntries(Object.entries(v.request).reverse()) as Schemas["RouteRequest"];
    expect(changed(loaded, reordered, undone)).toBe(false);
  });

  it("when another card is selected", () => {
    expect(changed(loaded, v.request, v.candidates[1]!)).toBe(true);
  });

  it("when the request differs, even on the same geometry", () => {
    const same = { ...v.candidates[0]!, route_id: "11111111-1111-1111-1111-111111111111" };
    expect(changed(loaded, { ...v.request, target_distance_m: 25100 }, same)).toBe(true);
  });
});
