import { describe, expect, it } from "vitest";
import spec from "./openapi.json";

describe("generated API types", () => {
  it("come from a schema that has the Phase 5 additions", () => {
    const schemas = (spec as { components: { schemas: Record<string, unknown> } }).components.schemas;
    for (const name of ["RouteRequest", "PlanVersionOut", "DiffOut", "FixOut", "PatchOp", "ElevationOut",
      "FeatureItemOut", "NearbyOut"]) {
      expect(schemas[name], name).toBeDefined();
    }
  });
});
