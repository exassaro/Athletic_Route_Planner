"use client";
import { useEffect, useRef } from "react";
import { ARRIVAL_HOPS, hop } from "@/map/markers";
import { Sprite } from "./Sprite";

/**
 * The mascot (amendment 16): the same sneaker at 3 px a pixel on a soft shadow. It hops three times when it appears
 * and once per tap, then rests, like the start pin. Decoration, so it is hidden from screen readers.
 */
export function Mascot() {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (el.current) hop(el.current, ARRIVAL_HOPS);
  }, []);
  return (
    <span ref={el} className="mascot" aria-hidden="true" data-testid="mascot" onClick={(e) => hop(e.currentTarget, 1)}
      onAnimationEnd={(e) => {
        if ((e.target as Element).classList.contains("mascot-hop")) e.currentTarget.classList.remove("hop");
      }}>
      <span className="mascot-shade" />
      <span className="mascot-hop"><Sprite name="sneaker" scale={3} /></span>
    </span>
  );
}
