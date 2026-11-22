import { describe, expect, it } from "vitest";
import { lineStyle, ROUTE_COLORS } from "@/plan/routeStyle";
import { basemapStyle, flavor, keepDrawn } from "./basemap";
import { endFlag, flagPointsLeft, groupByScreen, placePoint, startPin, stopPin } from "./markers";

describe("markers", () => {
  it("the start pin: the sneaker, labelled, a 52 × 44 tap target, the sole's middle on the point either way", () => {
    const east = startPin("Athanikkal", false);
    const west = startPin("Athanikkal", true);
    expect(east.el.getAttribute("aria-label")).toBe("Start: Athanikkal");
    expect(east.el.className).toBe("pin-start");
    expect(east.el.querySelector(".pin-start-hop svg")?.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(west.el.querySelector(".pin-start-flip.west")).toBeTruthy();
    expect(east.el.querySelector(".pin-start-flip.west")).toBeNull();
    // 52 px root, 46.5 px sprite centred; the sole's middle is 14.5 sprite px from the toe end's opposite edge
    expect(east.offset[0]).toBeCloseTo(1.5);
    expect(west.offset[0]).toBeCloseTo(-1.5);
  });

  it("stops: numbered discs, filled for must reach, dashed as asked; a diamond for the place; the flag", () => {
    const s = stopPin("3", "Stop 3: Chaliyam, at 6.0 km", { must: true });
    expect([s.textContent, s.className, s.getAttribute("aria-label")]).toEqual(["3", "pin-stop must", "Stop 3: Chaliyam, at 6.0 km"]);
    expect(stopPin("1·2", "two stops").className).toBe("pin-stop group");
    expect(stopPin("1", "asked", { asked: true }).className).toBe("pin-stop asked");
    expect(placePoint("Chaliyam").getAttribute("aria-label")).toBe("Chaliyam: the place itself");
    expect(endFlag("End (auto): Francis Road").el.querySelectorAll("path")).toHaveLength(3);
  });

  it("the flag's pole stays on the end point either way", () => {
    expect(endFlag("End")).toMatchObject({ anchor: "bottom-left", offset: [-2, 2] });
    const west = endFlag("End", true);
    expect(west).toMatchObject({ anchor: "bottom-right", offset: [2, 2] });
    expect(west.el.className).toBe("pin-end west");
  });

  it("the flag flies away from the route", () => {
    const end = { x: 100, y: 100 };
    expect(flagPointsLeft(end, [{ x: 160, y: 130 }, { x: 130, y: 110 }, end])).toBe(true);
    expect(flagPointsLeft(end, [{ x: 40, y: 130 }, { x: 70, y: 110 }, end])).toBe(false);
    expect(flagPointsLeft(end, [{ x: 100, y: 160 }, end]), "straight from below: to the right").toBe(false);
    expect(flagPointsLeft(end, [{ x: 900, y: 100 }, { x: 800, y: 100 }]), "only the route near the end votes").toBe(false);
  });

  it("groups stops that overlap on screen, in route order", () => {
    const g = groupByScreen([{ x: 100, y: 100, item: 1 }, { x: 118, y: 104, item: 2 }, { x: 200, y: 100, item: 3 }, { x: 205, y: 300, item: 4 }]);
    expect(g.map((x) => x.items)).toEqual([[1, 2], [3], [4]]);
  });
});

describe("route style", () => {
  it("the first route in the accent, the second in ink and always dashed; per theme", () => {
    expect(lineStyle("recommended", "main", 0, "light")).toMatchObject({ color: ROUTE_COLORS.light.primary, dash: null });
    expect(lineStyle("shortest", "continue_past_target", 1, "dark")).toMatchObject({ color: ROUTE_COLORS.dark.second });
    expect(lineStyle("shortest", "continue_past_target", 1).dash).not.toBeNull();
    expect(lineStyle("loop_2", "main", 1).dash).not.toBeNull();
    expect(ROUTE_COLORS.light.primary).toBe("#0F6E56");
  });
});

describe("basemap", () => {
  it("light and dark flavours, quietened to the palette, with their own sprites", () => {
    expect(flavor("light")).toMatchObject({ earth: "#ECE9E3", water: "#CFDDE1" });
    expect(flavor("dark")).toMatchObject({ earth: "#1B1E22", water: "#1F3138" });
    const town = basemapStyle("https://x").layers.find((l) => l.id === "places_locality")!;
    expect((town.layout as Record<string, unknown>)["text-variable-anchor"]).toContain("top");
    expect(basemapStyle("https://x", "dark").sprite).toBe("https://x/basemap/sprites/dark");
  });

  it("switching keeps what the planner drew", () => {
    const light = basemapStyle("https://x", "light");
    const drawn = { ...light, sources: { ...light.sources, "cand-0": { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } } },
      layers: [...light.layers, { id: "cand-0", type: "line" as const, source: "cand-0" }] };
    const next = keepDrawn(drawn, basemapStyle("https://x", "dark"));
    expect(next.sources["cand-0"]).toBeTruthy();
    expect(next.layers[next.layers.length - 1]!.id).toBe("cand-0");
    expect(next.layers.filter((l) => l.id === "cand-0")).toHaveLength(1);
  });
});
