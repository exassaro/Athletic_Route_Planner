"use client";
/**
 * The route cards as a swipeable row (blueprint Phase 5b amendment 8). A swipe that settles on a card selects it
 * (the map follows); a tap on a card's head selects it and brings it into view. "Why this route?" opens the API's
 * template explanation once, below the row, instead of a paragraph that repeats the numbers above it.
 */
import { useEffect, useRef, useState } from "react";
import type { Schemas } from "@/api/client";
import { CandidateCard } from "./CandidateCard";

type Props = {
  candidates: Schemas["CandidateOut"][];
  selected: number;
  onSelect: (i: number) => void;
  pace: number;
  target: number;
  explanation?: string | null;
  versionKey: string;
};

/** The card whose centre is nearest the row's centre: the one a swipe settled on. */
export function settledIndex(scrollLeft: number, width: number, cards: { left: number; width: number }[]): number {
  const centre = scrollLeft + width / 2;
  let best = 0;
  cards.forEach((c, i) => {
    if (Math.abs(c.left + c.width / 2 - centre) < Math.abs(cards[best]!.left + cards[best]!.width / 2 - centre)) best = i;
  });
  return best;
}

export function RouteCards({ candidates, selected, onSelect, pace, target, explanation, versionKey }: Props) {
  const row = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [why, setWhy] = useState(false);

  // A new version starts at the card it selects (the first, or the saved route's while one is edited).
  useEffect(() => {
    const el = row.current;
    const card = el?.children[selected] as HTMLElement | undefined;
    if (!el?.scrollTo) return;
    el.scrollTo({ left: card && selected > 0 ? card.offsetLeft - el.offsetLeft - (el.clientWidth - card.offsetWidth) / 2 : 0 });
    // only when the version changes: selecting a card scrolls by itself
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey]);

  const onScroll = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = row.current;
      if (!el) return;
      const cards = [...el.children].map((c) => ({ left: (c as HTMLElement).offsetLeft - el.offsetLeft, width: (c as HTMLElement).offsetWidth }));
      const i = settledIndex(el.scrollLeft, el.clientWidth, cards);
      if (i !== selected) onSelect(i);
    }, 140);
  };

  const pick = (i: number) => {
    onSelect(i);
    const card = row.current?.children[i] as HTMLElement | undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
  };

  if (!candidates.length) return null;
  return (
    <section className="route-cards" aria-label="Routes">
      <div className="route-row" role="list" ref={row} onScroll={onScroll}>
        {candidates.map((c, i) => (
          <div role="listitem" key={c.route_id} className="route-slot">
            <CandidateCard cand={c} index={i} total={candidates.length} selected={i === selected} pace={pace} target={target}
              onSelect={() => pick(i)} onWhy={explanation ? () => setWhy(!why) : undefined} whyOpen={why} />
          </div>
        ))}
      </div>
      {why && explanation && (
        <p id="why-this-route" className="why t-body-s" data-testid="explanation">{explanation}</p>
      )}
    </section>
  );
}
