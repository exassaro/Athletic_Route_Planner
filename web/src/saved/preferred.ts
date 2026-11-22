import type { Schemas } from "@/api/client";

type Candidate = Schemas["CandidateOut"];

/**
 * The card a version opens on (blueprint Phase 5c amendment 2). Editing a saved route: that very route, else the
 * same alternative (label and option, or its label: an over-budget answer renames the options), else the first.
 */
export function preferredCandidate(candidates: Candidate[], saved: Candidate | null): number {
  if (!saved) return 0;
  const same = candidates.findIndex((c) => c.route_id === saved.route_id);
  if (same >= 0) return same;
  const exact = candidates.findIndex((c) => c.label === saved.label && c.option === saved.option);
  return exact >= 0 ? exact : Math.max(0, candidates.findIndex((c) => c.label === saved.label));
}
