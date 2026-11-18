/**
 * The GATHO pixel sprites (blueprint Phase 5b amendment 6), drawn from the generated path data: crisp rectangles,
 * the depth layer underneath. Whole-number scales keep the pixels square.
 */
import { SPRITES, type SpriteData } from "@/brand/sprites";

function Paths({ s, dx = 0 }: { s: SpriteData; dx?: number }) {
  return (
    <g transform={dx ? `translate(${dx} 0)` : undefined}>
      <path d={s.depth} fill="#000" fillOpacity={s.depthOpacity} />
      {s.layers.map((l, i) => <path key={i} d={l.d} fill={l.fill} />)}
    </g>
  );
}

type Props = { name: "sneaker" | "runner"; scale?: number; mirror?: boolean; label?: string; className?: string };

/** One sprite. With a label it is an image with that name; without, decoration. */
export function Sprite({ name, scale = 2, mirror, label, className }: Props) {
  const s = SPRITES[name];
  return (
    <svg className={className} width={s.w * scale} height={s.h * scale} viewBox={`0 0 ${s.w} ${s.h}`} shapeRendering="crispEdges"
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g transform={mirror ? `translate(${s.w} 0) scale(-1 1)` : undefined}><Paths s={s} /></g>
    </svg>
  );
}

/**
 * The runner running in place (the loading state): the four approved frames side by side in one strip, moved by
 * a CSS steps(4) animation (transform only, so no layout or paint work per frame). Still with reduced motion.
 */
export function RunCycle({ scale = 2, className }: { scale?: number; className?: string }) {
  const frames = SPRITES.runCycle;
  const { w, h } = frames[0]!;
  return (
    <span className={`run-cycle ${className ?? ""}`} style={{ width: w * scale, height: h * scale }} aria-hidden="true">
      <svg className="run-cycle-strip" width={w * scale * frames.length} height={h * scale} viewBox={`0 0 ${w * frames.length} ${h}`}
        shapeRendering="crispEdges" style={{ ["--run-shift" as string]: `-${w * scale * frames.length}px` }}>
        {frames.map((f, i) => <Paths key={i} s={f} dx={i * w} />)}
      </svg>
    </span>
  );
}
