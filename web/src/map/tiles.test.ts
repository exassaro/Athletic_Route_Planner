/** The basemap never reads the browser cache, whatever the user agent, and a failure is retried once (amendment 12). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { basemapArchive, RETRY_MS, watchBasemap } from "./tiles";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("basemapArchive", () => {
  for (const [name, userAgent] of [
    ["an emulated iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1"],
    ["Chrome on Android", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"],
  ] as const) {
    it(`fetches with no-store on ${name}`, async () => {
      vi.stubGlobal("navigator", { userAgent });
      const fetch = vi.fn().mockResolvedValue(new Response(new ArrayBuffer(8), { status: 206, headers: { "Content-Length": "8" } }));
      vi.stubGlobal("fetch", fetch);
      await basemapArchive("http://x/kerala.pmtiles").source.getBytes(0, 8);
      expect(fetch.mock.calls[0]![1].cache).toBe("no-store");
    });
  }
});

describe("watchBasemap", () => {
  function setup() {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fire: (e: unknown) => void = () => {};
    const map = { on: (_: string, f: (e: unknown) => void) => { fire = f; }, off: vi.fn() };
    const refetch = vi.fn();
    const failed = vi.fn();
    const watch = watchBasemap(map as never, refetch, failed);
    return { watch, refetch, failed, fail: (sourceId = "protomaps") => fire({ sourceId, error: new Error("no tiles") }) };
  }

  it("retries once, then says it failed", () => {
    const t = setup();
    t.fail();
    t.fail(); // the same failure, from another tile
    vi.advanceTimersByTime(RETRY_MS);
    expect(t.refetch).toHaveBeenCalledTimes(1);
    expect(t.failed).not.toHaveBeenCalled();
    t.fail();
    expect(t.failed).toHaveBeenLastCalledWith(true);
    t.watch.retry();
    expect(t.refetch).toHaveBeenCalledTimes(2);
    expect(t.failed).toHaveBeenLastCalledWith(false);
  });

  it("ignores errors from other sources", () => {
    const t = setup();
    t.fail("km-marks");
    vi.advanceTimersByTime(RETRY_MS);
    expect(t.refetch).not.toHaveBeenCalled();
  });

  it("does not retry after the map has gone", () => {
    const t = setup();
    t.fail();
    t.watch.stop();
    vi.advanceTimersByTime(RETRY_MS);
    expect(t.refetch).not.toHaveBeenCalled();
  });
});
