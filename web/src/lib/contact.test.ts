import { describe, expect, it } from "vitest";
import { contactEmail } from "./contact";

describe("contactEmail", () => {
  it("takes a plain address and leaves anything else out", () => {
    expect(contactEmail(" hello@example.org ")).toBe("hello@example.org");
    for (const v of [undefined, "", "  ", "not an address", "a@b", "x@y.z\" onclick=\"1", "<a@b.c>"]) {
      expect(contactEmail(v)).toBeNull();
    }
  });
});
