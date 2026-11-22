/**
 * The GATHO pixel sprites (blueprint Phase 5b amendment 6), drawn from the generated path data: crisp rectangles,
 * the depth layer underneath. Whole-number scales keep the pixels square.
 */
import { CYCLE_FRAME_MS, SPRITES, type SpriteData } from "@/brand/sprites";

function Paths({ s, dx = 0 }: { s: SpriteData; dx?: number }) {
  return (
    <g transform={dx ? `translate(${dx} 0)` : undefined}>
      <path d={s.depth} fill="#000" fillOpacity={s.depthOpacity} />
      {s.layers.map((l, i) => <path key={i} d={l.d} fill={l.fill} />)}
    </g>
  );
}

type Props = { name: "sneaker"; scale?: number; mirror?: boolean; label?: string; className?: string };

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
 * The loading state (amendment 17): four frames of the sneaker with its dust and three dots, side by side in one
 * strip moved by a CSS steps(4) animation (transform only, so no layout or paint work per frame). It exists only
 * while a solve runs. Still with reduced motion.
 */
export function SneakerCycle({ scale = 2 }: { scale?: number }) {
  const frames = SPRITES.cycle;
  const { w, h } = frames[0]!;
  const strip = w * scale * frames.length;
  return (
    <span className="sneaker-cycle" style={{ width: w * scale, height: h * scale }} aria-hidden="true">
      <svg className="sneaker-cycle-strip" width={strip} height={h * scale} viewBox={`0 0 ${w * frames.length} ${h}`}
        shapeRendering="crispEdges"
        style={{ ["--cycle-shift" as string]: `-${strip}px`, ["--cycle-ms" as string]: `${CYCLE_FRAME_MS * frames.length}ms` }}>
        {frames.map((f, i) => (
          <g key={i}>
            <Paths s={f} dx={i * w} />
            <g transform={`translate(${i * w} 0)`}>
              <path className="cycle-dust" d={f.dust} />
              <path className="cycle-dots" d={f.dots} />
              <path className="cycle-dots-faint" d={f.dotsFaint} />
            </g>
          </g>
        ))}
      </svg>
    </span>
  );
}
