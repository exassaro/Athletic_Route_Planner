"use client";
/**
 * The planner's bottom sheet (blueprint Phase 5b amendment 8): peek, half and full on a phone; a side panel on a
 * desktop (900 px and wider). The three positions are CSS (the planner root's sheet-* class sets --snap-h); a drag
 * only moves the sheet with a transform, so it stays smooth, and on release it settles on a position chosen by
 * snapAfterDrag. The handle is a button: tap or Enter cycles, the arrow keys go up and down. Focus moving into a
 * peeked sheet opens it to half, so nothing focused is hidden; when a tap moved the focus, only once the tap is
 * done, or the button would slide from under the finger and the tap would be lost.
 *
 * The banner (the Undo message, amendment 15) belongs to the sheet so it moves with it: just above its top edge on
 * a phone, in its own row under the handle at full, over the map beside the panel on a desktop.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

export type Snap = "peek" | "half" | "full";
export const SNAPS: Snap[] = ["peek", "half", "full"];

/** Tap cycles peek → half → full → peek, as the Phase 5 handle did. */
export function nextSnap(s: Snap): Snap {
  return SNAPS[(SNAPS.indexOf(s) + 1) % SNAPS.length]!;
}

/**
 * Where a drag settles: a fast flick (0.5 px/ms or more) goes one position in its direction; otherwise the position
 * nearest to where the sheet was let go. Heights are the visible heights of each position in px.
 */
export function snapAfterDrag(from: Snap, visible: number, velocity: number, heights: Record<Snap, number>): Snap {
  const i = SNAPS.indexOf(from);
  if (velocity <= -0.5) return SNAPS[Math.min(i + 1, 2)]!;   // finger moving up: taller
  if (velocity >= 0.5) return SNAPS[Math.max(i - 1, 0)]!;
  return SNAPS.reduce((best, s) => (Math.abs(heights[s] - visible) < Math.abs(heights[best] - visible) ? s : best), from);
}

/** halfRatio: the share of the screen "half" takes (the planner root's CSS says the same: 0.5, or 0.64 in setup). */
type Props = { snap: Snap; onSnap: (s: Snap) => void; label: string; children: ReactNode; halfRatio?: number; banner?: ReactNode };

type Drag = { id: number; startY: number; startVisible: number; full: number; lastY: number; lastT: number; v: number; moved: boolean };

export function BottomSheet({ snap, onSnap, label, children, halfRatio = 0.5, banner }: Props) {
  const sheet = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  // A peeked sheet shows the top of its content (the peek bar), wherever it was scrolled before.
  useEffect(() => {
    if (snap === "peek" && body.current) body.current.scrollTop = 0;
  }, [snap]);
  const suppressClick = useRef(false);
  // a press in the sheet (focus follows it within the second), and whether it should open the sheet when it ends
  const press = useRef({ at: -Infinity, opens: false });
  const [dragging, setDragging] = useState(false);

  const heights = (): Record<Snap, number> => {
    const el = sheet.current!;
    const full = el.offsetHeight;
    const css = getComputedStyle(el);
    return { peek: parseFloat(css.getPropertyValue("--peek-px")) || 136, half: Math.round(window.innerHeight * halfRatio), full };
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const el = sheet.current;
    if (!el || window.matchMedia("(min-width: 900px)").matches) return;
    const rect = el.getBoundingClientRect();
    drag.current = { id: e.pointerId, startY: e.clientY, startVisible: window.innerHeight - rect.top, full: el.offsetHeight,
      lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !sheet.current) return;
    if (!d.moved && Math.abs(e.clientY - d.startY) < 6) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    const h = heights();
    const visible = Math.min(h.full, Math.max(h.peek, d.startVisible - (e.clientY - d.startY)));
    sheet.current.style.transform = `translateY(${d.full - visible}px)`;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
  };

  const onPointerEnd = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved || !sheet.current) return;
    suppressClick.current = true;            // the click that follows a drag is not a tap
    const visible = window.innerHeight - sheet.current.getBoundingClientRect().top;
    sheet.current.style.transform = "";      // back to the CSS position, which the new class sets
    setDragging(false);
    onSnap(snapAfterDrag(snap, visible, d.v, heights()));
  };

  const onClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSnap(nextSnap(snap));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = SNAPS.indexOf(snap);
    if (e.key === "ArrowUp" && i < 2) onSnap(SNAPS[i + 1]!);
    else if (e.key === "ArrowDown" && i > 0) onSnap(SNAPS[i - 1]!);
    else return;
    e.preventDefault();
  };

  return (
    <section ref={sheet} className={`sheet ${snap}${dragging ? " dragging" : ""}`} aria-label={label} data-snap={snap}
      onPointerDownCapture={() => { press.current = { at: performance.now(), opens: false }; }}
      onClick={() => {
        const { opens } = press.current;
        press.current = { at: -Infinity, opens: false };
        if (opens && snap === "peek") onSnap("half");
      }}
      onFocusCapture={(e) => {
        const el = e.target as HTMLElement;
        if (snap !== "peek" || el === e.currentTarget || el.closest(".sheet-handle, .sheet-banner")) return;
        if (performance.now() - press.current.at < 1000) press.current.opens = true;
        else onSnap("half");
      }}>
      <button type="button" className="sheet-handle" aria-label={snap === "full" ? "Show the map" : "Show more"}
        aria-describedby="sheet-handle-hint" onClick={onClick} onKeyDown={onKeyDown}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
        <span aria-hidden="true" />
      </button>
      <span id="sheet-handle-hint" className="sr-only">Drag, tap, or use the arrow keys to change the panel size.</span>
      {banner && <div className="sheet-banner">{banner}</div>}
      <div className="sheet-body" ref={body}>{children}</div>
    </section>
  );
}
