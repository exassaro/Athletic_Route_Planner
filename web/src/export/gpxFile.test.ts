/** Sharing the GPX falls back to a download (amendment 20). */
import { describe, expect, it, vi } from "vitest";
import { fileName, shareOrSave } from "./gpxFile";

const file = new File(["<gpx/>"], "route.gpx", { type: "application/gpx+xml" });
const failing = (name: string) => vi.fn().mockRejectedValue(Object.assign(new Error(name), { name }));

describe("shareOrSave", () => {
  it("shares where the browser can, without downloading", async () => {
    const save = vi.fn();
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareOrSave(file, { share, canShare: () => true }, save)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file] });
    expect(save).not.toHaveBeenCalled();
  });

  it("downloads where there is no file sharing", async () => {
    const save = vi.fn();
    expect(await shareOrSave(file, {}, save)).toBe("unsupported");
    expect(await shareOrSave(file, { share: vi.fn(), canShare: () => false }, save)).toBe("unsupported");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("downloads when Chromium refuses a .gpx after saying it could", async () => {
    const save = vi.fn();
    expect(await shareOrSave(file, { share: failing("NotAllowedError"), canShare: () => true }, save)).toBe("refused");
    expect(save).toHaveBeenCalledWith(file);
  });

  it("closing the share sheet downloads nothing", async () => {
    const save = vi.fn();
    expect(await shareOrSave(file, { share: failing("AbortError"), canShare: () => true }, save)).toBe("cancelled");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("fileName", () => {
  it("is the API's, or route.gpx", () => {
    expect(fileName(new Response("", { headers: { "Content-Disposition": 'attachment; filename="coast.gpx"' } }))).toBe("coast.gpx");
    expect(fileName(new Response(""))).toBe("route.gpx");
  });
});
