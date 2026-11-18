import { describe, expect, it } from "vitest";
import spec from "./openapi.json";
import { REQUEST_DEFAULTED } from "./client";

describe("generated API types", () => {
  it("come from a schema that has the Phase 5 additions", () => {
    const schemas = (spec as { components: { schemas: Record<string, unknown> } }).components.schemas;
    for (const name of ["RouteRequest", "PlanVersionOut", "DiffOut", "FixOut", "PatchOp", "ElevationOut",
      "FeatureItemOut", "NearbyOut"]) {
      expect(schemas[name], name).toBeDefined();
    }
  });
});

describe("NewRouteRequest", () => {
  it("leaves out exactly the RouteRequest fields the API defaults", () => {
    const rr = (spec as unknown as { components: { schemas: { RouteRequest: { properties: Record<string, { default?: unknown }>; required: string[] } } } })
      .components.schemas.RouteRequest;
    const defaulted = Object.entries(rr.properties).filter(([k, v]) => "default" in v && !rr.required.includes(k)).map(([k]) => k);
    expect([...REQUEST_DEFAULTED].sort()).toEqual(defaulted.sort());
  });
});
