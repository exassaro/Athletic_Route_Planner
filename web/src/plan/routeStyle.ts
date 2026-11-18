/**
 * How each candidate is drawn (Phase 5 screens; Phase 5b amendment 4): the first route in the accent, every other
 * in the neutral ink, and a dash pattern per option, so routes never differ by colour alone. Colours per theme,
 * chosen for contrast on the basemap's land in sunlight (light) and at night (dark); the casing under the line
 * separates it from the roads. The card shows the same line as a swatch and names it.
 */
import type { Theme } from "@/theme/theme";

export type LineStyle = { color: string; dash: number[] | null; name: string; optionName: string };

/** Route colours per theme: the accent (5.1:1 on light land, 7.3:1 on dark) and the ink, plus the casing. */
export const ROUTE_COLORS: Record<Theme, { primary: string; second: string; casing: string; link: string }> = {
  light: { primary: "#0F6E56", second: "#1C1B18", casing: "#FFFFFF", link: "#1C1B18" },
  dark: { primary: "#3DBFA3", second: "#F2ECDF", casing: "#0B0C0E", link: "#F2ECDF" },
};

const ALTERNATIVE: Record<string, { primary: boolean; name: string }> = {
  recommended: { primary: true, name: "Recommended" },
  shortest: { primary: false, name: "Shortest" },
  loop_1: { primary: true, name: "Loop 1" },
  loop_2: { primary: false, name: "Loop 2" },
};

const OPTION: Record<string, { dash: number[] | null; name: string }> = {
  main: { dash: null, name: "" },
  full_route: { dash: null, name: "Full route through every stop" },
  cut_at_target: { dash: [2, 1.5], name: "Cut at your distance" },
  continue_past_target: { dash: null, name: "Carries on past the target" },
  end_at_target: { dash: [0.5, 1.5], name: "Ends at the target (shorter)" },
  detour_to_target: { dash: [3, 1, 0.5, 1], name: "Detour, then ends at the target" },
  out_and_back: { dash: [2, 1.5], name: "Out-and-back instead" },
  short_loop: { dash: [0.5, 1.5], name: "Shorter loop" },
};

/** A second alternative is always dashed, even for an option drawn solid, so it never differs by colour alone. */
const SECOND_DASH = [1.5, 1];

export function lineStyle(label: string, option: string, index = 0, theme: Theme = "light"): LineStyle {
  const alt = ALTERNATIVE[label] ?? { primary: index === 0, name: label.replace(/_/g, " ") };
  const opt = OPTION[option] ?? { dash: [1, 1], name: option.replace(/_/g, " ") };
  const c = ROUTE_COLORS[theme];
  return { color: alt.primary ? c.primary : c.second, dash: opt.dash ?? (alt.primary ? null : SECOND_DASH), name: alt.name,
    optionName: opt.name };
}

/** SVG stroke-dasharray for a swatch, from MapLibre's line-dasharray (in line widths). */
export function svgDash(dash: number[] | null, width: number): string | undefined {
  return dash ? dash.map((d) => d * width).join(" ") : undefined;
}
