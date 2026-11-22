"use client";
/**
 * The plan as chips (blueprint Phase 5b amendment 8): one chip per constraint of the current RouteRequest; a tap
 * opens its editor. The chip that needs changing (the distance, when the stops need more than it) is marked.
 * The row scrolls: it fades at an edge with more beyond it, and snaps chip by chip (amendment 15).
 */
import { useEffect, useRef, useState } from "react";
import type { RouteRequest } from "@/plan/edits";
import { km } from "@/plan/format";
import type { IconName } from "@/brand/icons";
import { Chip } from "./ui";
import { Num } from "./Num";

export type ChipKey = "start" | "distance" | "type" | "direction" | "stops" | "via" | "must_use" | "avoid" | "paths";

const SHAPE: Record<RouteRequest["route_type"], { label: string; icon: IconName }> = {
  point_to_point: { label: "Point to point", icon: "pointToPoint" },
  out_and_back: { label: "Out and back", icon: "outAndBack" },
  loop: { label: "Loop", icon: "loop" },
};

type Props = { request: RouteRequest; attention?: ChipKey[]; onOpen: (key: ChipKey) => void };

/** Which edges of a scrolling row have more beyond them (1 px of slack for fractional widths). */
export function hiddenEdges(scrollLeft: number, width: number, contentWidth: number) {
  return { left: scrollLeft > 1, right: scrollLeft + width < contentWidth - 1 };
}

export function PlanChips({ request, attention = [], onOpen }: Props) {
  const row = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => setMore((was) => {
      const now = hiddenEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
      return now.left === was.left && now.right === was.right ? was : now;
    });
    update();
    el.addEventListener("scroll", update, { passive: true });
    const size = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    size?.observe(el);
    for (const chip of el.children) size?.observe(chip);   // a longer label moves the edge too
    return () => {
      el.removeEventListener("scroll", update);
      size?.disconnect();
    };
  }, [request]);
  const chips: { key: ChipKey; label: React.ReactNode; icon?: IconName; name: string }[] = [];
  if (request.start) chips.push({ key: "start", label: `From ${request.start.label ?? "a point"}`, icon: "mapPin", name: "Change the start" });
  chips.push({ key: "distance", name: "Change the distance",
    label: <Num value={request.target_distance_m} format={(m) => km(m)} field="target_distance_m" /> });
  const shape = SHAPE[request.route_type];
  chips.push({ key: "type", label: shape.label, icon: shape.icon, name: "Change the route shape" });
  const d = request.direction;
  chips.push({ key: "direction", name: "Change the direction",
    label: d ? (d.kind === "towards_place" ? `Towards ${d.place.label ?? "a point"}` : `Heading ${d.degrees}°`) : "Any direction" });
  const n = request.checkpoints?.length ?? 0;
  chips.push({ key: "stops", name: "Go to the stops", icon: n ? undefined : "plus",
    label: n ? `${n} stop${n > 1 ? "s" : ""}${request.checkpoint_order === "fixed" ? " (my order)" : ""}` : "Stops" });
  if (request.via?.length) chips.push({ key: "via", name: "Go to the stops", label: `via ${request.via.map((x) => x.label ?? "a point").join(", ")}` });
  if (request.must_use?.length) chips.push({ key: "must_use", name: "Go to the stops", label: `uses ${request.must_use.map((x) => x.label).join(", ")}` });
  if (request.avoid?.length) chips.push({ key: "avoid", name: "Go to the stops", label: `avoids ${request.avoid.map((x) => x.label).join(", ")}` });
  chips.push({ key: "paths", name: "Change the road preference",
    label: request.preferences?.paths === "allow" ? "Paths allowed" : "Roads first" });
  return (
    <ul ref={row} className={`plan-chips${more.left ? " more-left" : ""}${more.right ? " more-right" : ""}`} aria-label="Your plan: tap a chip to change it" data-testid="chips">
      {chips.map((c) => (
        <li key={c.key} data-chip={c.key}>
          <Chip icon={c.icon} attention={attention.includes(c.key)} onClick={() => onOpen(c.key)}
            aria-haspopup={["stops", "via", "must_use", "avoid"].includes(c.key) ? undefined : "dialog"}
            title={c.name}>
            {c.label}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
