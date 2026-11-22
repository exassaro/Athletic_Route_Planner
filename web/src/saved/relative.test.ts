import { describe, expect, it } from "vitest";
import { relativeDate } from "./relative";

const now = Date.parse("2026-11-22T12:00:00Z");
const at = (iso: string) => relativeDate(iso, now);

describe("relativeDate", () => {
  it("reads as a person would say it", () => {
    expect(at("2026-11-22T11:59:30Z")).toBe("just now");
    expect(at("2026-11-22T12:00:05Z")).toBe("just now");        // the server's clock a little ahead
    expect(at("2026-11-22T11:59:00Z")).toBe("1 minute ago");
    expect(at("2026-11-22T09:00:00Z")).toBe("3 hours ago");
    expect(at("2026-11-21T10:00:00Z")).toBe("yesterday");
    expect(at("2026-11-18T10:00:00Z")).toBe("4 days ago");
    expect(at("2026-11-01T12:00:00Z")).toBe("on 1 Nov 2026");
  });
});
