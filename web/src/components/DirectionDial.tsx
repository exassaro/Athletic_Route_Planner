/**
 * The eight-point pixel dial in the direction picker (blueprint Phase 5b amendment 18): north at the top, the chosen
 * direction's square filled and joined to the middle. Decoration: the buttons round it carry the words.
 */
import { eighth } from "@/plan/direction";

const SIZE = 21;
const MID = 10;
/** Unit steps of the eight points, from north clockwise. */
const STEPS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
const reach = (i: number) => (i % 2 ? 6 : 8);   // the diagonals sit nearer, so the ring is round

const square = (x: number, y: number, r: number) => `M${x - r} ${y - r}h${2 * r + 1}v${2 * r + 1}h-${2 * r + 1}z`;
const ring = STEPS.map(([x, y], i) => square(MID + x * reach(i), MID + y * reach(i), i === 0 ? 1 : 0)).join("");

export function DirectionDial({ degrees }: { degrees: number | null }) {
  let chosen = "";
  if (degrees !== null) {
    const i = eighth(degrees);
    const [x, y] = STEPS[i]!;
    for (let n = 1; n < reach(i); n++) chosen += square(MID + x * n, MID + y * n, 0);
    chosen += square(MID + x * reach(i), MID + y * reach(i), 1);
  }
  return (
    <svg className="direction-dial" width={SIZE * 3} height={SIZE * 3} viewBox={`0 0 ${SIZE} ${SIZE}`} shapeRendering="crispEdges"
      aria-hidden="true" data-testid="direction-dial" data-point={degrees === null ? undefined : eighth(degrees)}>
      <path className="dial-points" d={ring + square(MID, MID, 1)} />
      {chosen && <path className="dial-chosen" d={chosen} />}
    </svg>
  );
}
