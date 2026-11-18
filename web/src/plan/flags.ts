/**
 * Flags in plain English (section 13 route cards; Phase 5b badges). `short` is the badge: a few words, no number.
 * `title` and `detail` open on tap: the title is fixed text; the detail is the API's own message, whose numbers come
 * from the solver. Unknown codes show the API message alone.
 */
import type { Schemas } from "@/api/client";

type Flag = Schemas["Flag"];
export type FlagText = { tone: "warn" | "info"; short: string; title: string; detail: string };

const TEXT: Partial<Record<Flag["code"], { tone: FlagText["tone"]; short: string; title: string }>> = {
  uses_national_highway: { tone: "warn", short: "National highway", title: "Uses a national highway: running there may be prohibited" },
  crosses_national_highway: { tone: "info", short: "Crosses a highway", title: "Crosses a national highway" },
  detour_eased: { tone: "info", short: "Preferences eased", title: "Road preferences were eased to keep the detour short" },
  pass_near_boundary: { tone: "info", short: "Through the area", title: "Passes through the place's area, not near its centre" },
  pass_near_spur: { tone: "info", short: "Short there-and-back", title: "Reaches a stop by a short there-and-back" },
  loop_fallback: { tone: "warn", short: "Out-and-back instead", title: "No loop found here: this is an out-and-back" },
  loop_not_found: { tone: "warn", short: "No loop found", title: "No loop of this distance found" },
  endpoint_mid_road: { tone: "info", short: "Ends mid-road", title: "Ends mid-road, at the exact distance" },
  spur: { tone: "info", short: "There-and-back", title: "Includes a short there-and-back" },
  repeated_edges: { tone: "warn", short: "Repeats roads", title: "Runs some roads twice" },
  short_of_budget: { tone: "info", short: "Shorter", title: "Shorter than your distance" },
  lengthened: { tone: "info", short: "Detour added", title: "Lengthened with a detour to reach your distance" },
  alternative_unavailable: { tone: "warn", short: "Engine down", title: "Only one route could be made: a routing engine is down" },
  alternative_over_budget: { tone: "info", short: "Over distance", title: "This alternative is over your distance" },
  direction_limited: { tone: "info", short: "Direction limited", title: "Could not go far in the direction you chose" },
  direction_ignored: { tone: "info", short: "Direction not used", title: "Direction not used for this route" },
  avoid_unmet: { tone: "warn", short: "Avoid not met", title: "Could not avoid everything you asked to avoid" },
  preference_unsupported: { tone: "info", short: "Not supported", title: "A preference is not supported yet" },
  checkpoint_far_from_network: { tone: "warn", short: "Stop off-road", title: "A stop is far from any walkable road" },
  engine_warning: { tone: "info", short: "Engine note", title: "Routing engine note" },
  engine_length_mismatch: { tone: "info", short: "Length note", title: "Length check note" },
  reroute_mismatch: { tone: "info", short: "Length note", title: "Length check note" },
};

export function flagText(flag: Flag): FlagText {
  const t = TEXT[flag.code];
  return t ? { ...t, detail: flag.message } : { tone: "info", short: "Note", title: flag.message, detail: "" };
}
