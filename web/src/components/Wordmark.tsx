/**
 * The GATHO wordmark (blueprint Phase 5b amendments 24 to 26): drawn from the pixel grids, never set in a font.
 * `height` is the letters' height; a margin of one cell goes round them. The colours are CSS variables, so a theme
 * switch needs no re-render. Under 14 px the icon is shown instead.
 */
import { LOGO } from "@/brand/logo";

export const WORDMARK_MIN_PX = 14;

export function Wordmark({ height = 21 }: { height?: number }) {
  if (height < WORDMARK_MIN_PX) {
    const { n, tile, o, dot } = LOGO.icon;
    return (
      <svg className="logo-icon" width={height} height={height} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="GATHO">
        <path className="logo-tile" d={tile} />
        <path className="logo-paper" d={o} />
        <path className="logo-dot" d={dot} />
      </svg>
    );
  }
  const { w, h, rows, ink, o, dot } = LOGO.wordmark;
  const cell = height / rows;
  return (
    <svg className="wordmark" width={w * cell} height={h * cell} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role="img" aria-label="GATHO">
      <rect className="logo-backing" width={w} height={h} />
      <path className="logo-ink" d={ink} />
      <path className="logo-o" d={o} />
      <path className="logo-dot" d={dot} />
    </svg>
  );
}
