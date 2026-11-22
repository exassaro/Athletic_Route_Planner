/**
 * The map's markers (blueprint Phase 5b amendment 6), built as DOM for MapLibre markers: the sneaker start pin (it
 * hops; mirrored when the route starts westward), the stop discs (outlined = pass near, filled = must reach),
 * grouped when they overlap on screen, the pass-near place points (small diamonds) and the pixel end flag. The
 * animation is CSS on an inner element only: MapLibre moves the marker's root with a transform.
 */
import { SPRITES } from "@/brand/sprites";

/** The sprite as SVG markup (the approved pixels; whole-pixel rects, the depth layer underneath). */
export function spriteSvg(name: "sneaker" | "runner", scale: number): string {
  const s = SPRITES[name];
  const paths = [`<path d="${s.depth}" fill="#000" fill-opacity="${s.depthOpacity}"/>`,
    ...s.layers.map((l) => `<path d="${l.d}" fill="${l.fill}"/>`)].join("");
  return `<svg width="${s.w * scale}" height="${s.h * scale}" viewBox="0 0 ${s.w} ${s.h}" shape-rendering="crispEdges" aria-hidden="true">${paths}</svg>`;
}

const SNEAKER_SCALE = 1.5;
const PIN_W = 52;

/**
 * The start pin: about 48 px wide, its root 52 × 44 px (the tap target), anchored at the middle of the sole. Returns
 * the element and the marker offset that puts the sole's middle on the point (MapLibre anchors the root's bottom
 * centre). The sole runs over sprite columns 2 to 27: its middle is 14.5 px from the left edge.
 */
export function startPin(label: string, facingWest: boolean): { el: HTMLElement; offset: [number, number] } {
  const s = SPRITES.sneaker;
  const left = (PIN_W - s.w * SNEAKER_SCALE) / 2;
  const soleMid = left + (facingWest ? s.w - 14.5 : 14.5) * SNEAKER_SCALE;
  const el = document.createElement("div");
  el.className = "pin-start";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `Start: ${label}`);
  el.title = `Start: ${label}`;
  el.innerHTML = `<span class="pin-start-shade"></span><span class="pin-start-flip${facingWest ? " west" : ""}">` +
    `<span class="pin-start-hop">${spriteSvg("sneaker", SNEAKER_SCALE)}</span></span>`;
  return { el, offset: [PIN_W / 2 - soleMid, 0] };
}

/** A stop's disc: its number (or "1·2" for a group), outlined for pass near, filled for must reach. */
export function stopPin(text: string, label: string, opts: { must?: boolean; asked?: boolean } = {}): HTMLElement {
  const el = document.createElement("div");
  el.className = `pin-stop${opts.must ? " must" : ""}${opts.asked ? " asked" : ""}${text.includes("·") ? " group" : ""}`;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.title = label;
  el.textContent = text;
  return el;
}

/** The place's own point, for a pass-near stop the route passes at a distance: a small diamond. */
export function placePoint(label: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "pin-place";
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", `${label}: the place itself`);
  el.title = `${label}: the place itself`;
  return el;
}

/**
 * The pixel end flag: a pole and a chequered flag (7 × 9 cells of 4 px), anchored so the foot of the pole's middle
 * is on the end point, whichever way it points (amendment 14).
 */
const FLAG = ["#######", "#.#.#.#", "##.#.##", "#.#.#.#", "#######", "#......", "#......", "#......", "##....."];
const FLAG_LIGHT = [".......", ".#.#.#.", "..#.#..", ".#.#.#.", ".......", ".......", ".......", ".......", "......."];
function cells(rows: string[], cell: number, dx = 0, dy = 0) {
  let d = "";
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === "#") d += `M${x * cell + dx} ${y * cell + dy}h${cell}v${cell}h-${cell}z`; }));
  return d;
}
export function endFlag(label: string, pointsWest = false): { el: HTMLElement; anchor: "bottom-left" | "bottom-right"; offset: [number, number] } {
  const el = document.createElement("div");
  el.className = `pin-end${pointsWest ? " west" : ""}`;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.title = label;
  el.innerHTML = `<svg width="30" height="38" viewBox="0 0 30 38" shape-rendering="crispEdges" aria-hidden="true">` +
    `<path class="pin-end-depth" d="${cells(FLAG, 4, 2, 2)}"/><path class="pin-end-ink" d="${cells(FLAG, 4)}"/>` +
    `<path class="pin-end-light" d="${cells(FLAG_LIGHT, 4)}"/></svg>`;
  // the pole is the first 4 px column; the svg has 2 px of depth below and beyond the cells
  return pointsWest ? { el, anchor: "bottom-right", offset: [2, 2] } : { el, anchor: "bottom-left", offset: [-2, 2] };
}

/**
 * Which way the flag flies: away from the route's line near the end. Screen positions only (map.project), like the
 * grouping: the route's points within `radius` px of the end vote for the side they are on; no vote keeps it right.
 */
export function flagPointsLeft(end: { x: number; y: number }, line: { x: number; y: number }[], radius = 70): boolean {
  let side = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const x = (a.x + b.x) / 2 - end.x;
    const y = (a.y + b.y) / 2 - end.y;
    if (Math.hypot(x, y) > radius) continue;
    side += x * Math.hypot(b.x - a.x, b.y - a.y);   // a long piece of line counts for more than a dense bend
  }
  return side > 1e-6;
}

/**
 * Stops whose discs would overlap on screen, grouped in route order: each group is the stops within `radius` px of
 * the group's first stop. Screen positions only (map.project); nothing is measured on the route.
 */
export function groupByScreen<T>(items: { x: number; y: number; item: T }[], radius = 30): { x: number; y: number; items: T[] }[] {
  const groups: { x: number; y: number; items: T[] }[] = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && Math.hypot(it.x - g.x, it.y - g.y) < radius) g.items.push(it.item);
    else groups.push({ x: it.x, y: it.y, items: [it.item] });
  }
  return groups;
}
