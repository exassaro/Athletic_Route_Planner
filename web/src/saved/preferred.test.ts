import { describe, expect, it } from "vitest";
import type { Schemas } from "@/api/client";
import { preferredCandidate } from "./preferred";

const cand = (route_id: string, label: string, option = "main") => ({ route_id, label, option }) as Schemas["CandidateOut"];
const saved = cand("r2", "shortest");

describe("preferredCandidate", () => {
  it("that route, else the same alternative, else the first", () => {
    expect(preferredCandidate([cand("r1", "recommended"), saved], saved)).toBe(1);
    expect(preferredCandidate([cand("r7", "recommended"), cand("r8", "shortest")], saved)).toBe(1);
    expect(preferredCandidate([cand("r7", "recommended", "full_route"), cand("r8", "shortest", "full_route")], saved)).toBe(1);
    expect(preferredCandidate([cand("r7", "recommended"), cand("r9", "loop_1")], saved)).toBe(0);
    expect(preferredCandidate([cand("r1", "recommended")], null)).toBe(0);
  });
});
