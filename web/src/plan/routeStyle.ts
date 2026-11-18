/**
 * How each candidate is drawn: a colour per alternative AND a dash pattern per option, so routes never differ
 * by colour alone (section 13, Phase 5 screens). The card shows the same line as a swatch and names it.
 */
export type LineStyle = { color: string; dash: number[] | null; name: string; optionName: string };

const ALTERNATIVE: Record<string, { color: string; name: string }> = {
  recommended: { color: "#0f6b4f", name: "Recommended" },
  shortest: { color: "#2457c5", name: "Shortest" },
  loop_1: { color: "#0f6b4f", name: "Loop 1" },
  loop_2: { color: "#b4410f", name: "Loop 2" },
};
const FALLBACK = ["#7a3db8", "#a15c00", "#00708a"];

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

export function lineStyle(label: string, option: string, index = 0): LineStyle {
  const alt = ALTERNATIVE[label] ?? { color: FALLBACK[index % FALLBACK.length]!, name: label.replace(/_/g, " ") };
  const opt = OPTION[option] ?? { dash: [1, 1], name: option.replace(/_/g, " ") };
  return { color: alt.color, dash: opt.dash, name: alt.name, optionName: opt.name };
}

/** SVG stroke-dasharray for a swatch, from MapLibre's line-dasharray (in line widths). */
export function svgDash(dash: number[] | null, width: number): string | undefined {
  return dash ? dash.map((d) => d * width).join(" ") : undefined;
}
