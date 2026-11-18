/**
 * Flags in plain English (section 13 route cards). The heading is fixed text with no number in it; the detail is
 * the API's own message, whose numbers come from the solver. Unknown codes show the API message alone.
 */
import type { Schemas } from "@/api/client";

type Flag = Schemas["Flag"];
export type FlagText = { tone: "warn" | "info"; title: string; detail: string };

const TEXT: Partial<Record<Flag["code"], { tone: FlagText["tone"]; title: string }>> = {
  uses_national_highway: { tone: "warn", title: "Uses a national highway: running there may be prohibited" },
  crosses_national_highway: { tone: "info", title: "Crosses a national highway" },
  detour_eased: { tone: "info", title: "Road preferences were eased to keep the detour short" },
  pass_near_boundary: { tone: "info", title: "Passes through the place's area, not near its centre" },
  pass_near_spur: { tone: "info", title: "Reaches a stop by a short there-and-back" },
  loop_fallback: { tone: "warn", title: "No loop found here: this is an out-and-back" },
  loop_not_found: { tone: "warn", title: "No loop of this distance found" },
  endpoint_mid_road: { tone: "info", title: "Ends mid-road, at the exact distance" },
  spur: { tone: "info", title: "Includes a short there-and-back" },
  repeated_edges: { tone: "warn", title: "Runs some roads twice" },
  short_of_budget: { tone: "info", title: "Shorter than your distance" },
  lengthened: { tone: "info", title: "Lengthened with a detour to reach your distance" },
  alternative_unavailable: { tone: "warn", title: "Only one route could be made: a routing engine is down" },
  alternative_over_budget: { tone: "info", title: "This alternative is over your distance" },
  direction_limited: { tone: "info", title: "Could not go far in the direction you chose" },
  direction_ignored: { tone: "info", title: "Direction not used for this route" },
  avoid_unmet: { tone: "warn", title: "Could not avoid everything you asked to avoid" },
  preference_unsupported: { tone: "info", title: "A preference is not supported yet" },
  checkpoint_far_from_network: { tone: "warn", title: "A stop is far from any walkable road" },
  engine_warning: { tone: "info", title: "Routing engine note" },
  engine_length_mismatch: { tone: "info", title: "Length check note" },
  reroute_mismatch: { tone: "info", title: "Length check note" },
};

export function flagText(flag: Flag): FlagText {
  const t = TEXT[flag.code];
  return t ? { ...t, detail: flag.message } : { tone: "info", title: flag.message, detail: "" };
}
