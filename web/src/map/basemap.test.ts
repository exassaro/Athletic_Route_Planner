import { afterEach, describe, expect, it, vi } from "vitest";
import { basemapOrigin, basemapStyle, basemapUrl } from "./basemap";

describe("basemapOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("unset: the page's own origin, as before the split", () => {
    vi.stubEnv("NEXT_PUBLIC_BASEMAP_ORIGIN", undefined);
    expect(basemapOrigin()).toBe(window.location.origin);
    expect(basemapOrigin("")).toBe(window.location.origin);
  });

  it("set: that origin, read from NEXT_PUBLIC_BASEMAP_ORIGIN, without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_BASEMAP_ORIGIN", "https://tiles.example.test");
    expect(basemapOrigin()).toBe("https://tiles.example.test");
    expect(basemapOrigin("https://tiles.example.test/")).toBe("https://tiles.example.test");
  });

  it("the archive, fonts and sprites all come from it", () => {
    const origin = basemapOrigin("https://tiles.example.test");
    expect(basemapUrl(origin)).toBe("https://tiles.example.test/basemap/kerala.pmtiles");
    const style = basemapStyle(origin, "dark");
    expect(style.glyphs).toBe("https://tiles.example.test/basemap/fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBe("https://tiles.example.test/basemap/sprites/dark");
    expect(style.sources.protomaps).toMatchObject({ url: "pmtiles://https://tiles.example.test/basemap/kerala.pmtiles" });
  });
});
