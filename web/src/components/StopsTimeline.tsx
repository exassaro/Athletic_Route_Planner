"use client";
/**
 * The stops as a vertical timeline (blueprint Phase 5b amendment 8): start, each stop, end, in the order the
 * selected route passes them, each with its distance mark (StopOnRoute.at_m, the API's) and how the route meets it.
 * A stop's node shows pass-near (outlined) or must-reach (filled), and the words say the same, so shape is never
 * the only sign. A stop's options (move, pass near / must reach, remove) open in a small dialog. The node is also a
 * drag handle and takes the arrow keys, as the Phase 5 handle did.
 *
 * Without a route (a conflict) the timeline is the request's own order, without distance marks.
 */
import { useRef, useState } from "react";
import type { Schemas } from "@/api/client";
import type { Edit, RouteRequest } from "@/plan/edits";
import { km, metres } from "@/plan/format";
import { EditorDialog } from "./EditorDialog";
import { Num } from "./Num";
import { Sprite } from "./Sprite";
import { Button, Icon, IconButton } from "./ui";

type Candidate = Schemas["CandidateOut"];
type StopOnRoute = NonNullable<Candidate["stops"]>[number];
type Checkpoint = NonNullable<RouteRequest["checkpoints"]>[number];

export type Row = { index: number; checkpoint: Checkpoint; at: StopOnRoute | null };

/**
 * The stops in the order the selected route passes them, each with its index in the request (matched by label, in
 * order, so two stops with the same name stay apart). Stops the route does not list come last, without a mark.
 */
export function timelineRows(request: RouteRequest, cand: Candidate | null): Row[] {
  const cps = request.checkpoints ?? [];
  const used = new Set<number>();
  const rows: Row[] = [];
  for (const s of (cand?.stops ?? []).filter((x) => x.role === "checkpoint")) {
    const i = cps.findIndex((c, k) => !used.has(k) && c.label === s.label);
    if (i < 0) continue;
    used.add(i);
    rows.push({ index: i, checkpoint: cps[i]!, at: s });
  }
  cps.forEach((c, i) => { if (!used.has(i)) rows.push({ index: i, checkpoint: c, at: null }); });
  return rows;
}

/**
 * Moving a stop in the order shown. When that order is the request's own, the targeted move patch (guarded by the
 * stop's label); when the route had reordered the stops (order "auto"), the whole list in the order shown, as "my
 * order", so what the runner sees is what is sent.
 */
export function moveEdit(request: RouteRequest, rows: Row[], from: number, to: number): Edit | null {
  if (to < 0 || to >= rows.length || from === to) return null;
  if (rows.every((r, k) => r.index === k)) {
    return { kind: "move_checkpoint", from, to, label: rows[from]!.checkpoint.label };
  }
  const order = rows.map((r) => r.checkpoint);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  return { kind: "restore", request: { ...request, checkpoints: order, checkpoint_order: "fixed" } };
}

const HOW: Record<string, string> = {
  on_route: "on the route", reached: "reached", boundary: "through its area", spur: "a short there-and-back", uses: "the route uses it",
};

function Meets({ c, at }: { c: Checkpoint; at: StopOnRoute | null }) {
  const kind = c.kind ?? "place";
  const mode = kind !== "place" ? (kind === "bridge" ? "Bridge" : "Road") : c.must_reach ? "Must reach" : "Pass near";
  if (!at) return <>{mode}</>;
  if (at.how === "via" && at.pass_walk_m != null) {
    return <>{mode} · <Num value={at.pass_walk_m} format={metres} field="stops.pass_walk_m" /> away on foot</>;
  }
  return <>{mode}{at.how && HOW[at.how] ? ` · ${HOW[at.how]}` : ""}</>;
}

type Props = {
  request: RouteRequest;
  selected: Candidate | null;
  onEdit: (e: Edit) => void;
  toggleReach: (i: number) => void;
};

export function StopsTimeline({ request, selected, onEdit, toggleReach }: Props) {
  const rows = timelineRows(request, selected);
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const start = selected?.stops?.find((s) => s.role === "start");
  const end = selected?.stops?.find((s) => s.role === "end");
  const move = (from: number, to: number) => {
    const e = moveEdit(request, rows, from, to);
    if (e) onEdit(e);
  };
  const overIndex = (y: number) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("li[data-stop]") ?? [])];
    const i = items.findIndex((el) => y < el.getBoundingClientRect().top + el.offsetHeight / 2);
    return i < 0 ? items.length - 1 : i;
  };
  const open = menu !== null ? rows[menu] : undefined;

  return (
    <>
      <ol className="timeline" ref={list} data-testid="stop-list">
        <li className="tl-row tl-start">
          <span className="tl-node" aria-hidden="true"><Sprite name="sneaker" scale={1} /></span>
          <span className="tl-text">
            <span className="tl-name">{request.start?.label ?? "Start"}</span>
            <span className="tl-sub t-meta muted">Start</span>
          </span>
          {start && <span className="tl-km"><Num value={start.at_m} format={(m) => km(m)} field="stops.at_m" /></span>}
          <span className="tl-gap" aria-hidden="true" />
        </li>
        {rows.length === 0 && (
          <li className="tl-row tl-empty"><span className="tl-node" aria-hidden="true" />
            <span className="tl-text t-body-s muted">No stops yet. Add the places you want to run through.</span></li>
        )}
        {rows.map((r, k) => (
          <li key={`${r.checkpoint.label}-${r.index}`} className={`tl-row${drag?.over === k ? " tl-drop" : ""}`}
            data-stop={r.checkpoint.label}>
            <button type="button" className={`tl-node tl-num${r.checkpoint.must_reach ? " must" : ""}`}
              aria-label={`Stop ${k + 1}, ${r.checkpoint.label}: drag or use the arrow keys to reorder`}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ from: k, over: k }); }}
              onPointerMove={(e) => drag && setDrag({ ...drag, over: overIndex(e.clientY) })}
              onPointerUp={() => { if (drag) move(drag.from, drag.over); setDrag(null); }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") { e.preventDefault(); move(k, k - 1); }
                if (e.key === "ArrowDown") { e.preventDefault(); move(k, k + 1); }
              }}>{k + 1}</button>
            <span className="tl-text">
              <span className="tl-name">{r.checkpoint.label}</span>
              <span className="tl-sub t-meta muted"><Meets c={r.checkpoint} at={r.at} /></span>
            </span>
            {r.at && <span className="tl-km"><Num value={r.at.at_m} format={(m) => km(m)} field="stops.at_m" /></span>}
            <IconButton icon="more" label={`Options for ${r.checkpoint.label}`} className="tl-more" onClick={() => setMenu(k)} />
          </li>
        ))}
        {selected && end && (
          <li className="tl-row tl-end">
            <span className="tl-node" aria-hidden="true"><Icon name="flag" /></span>
            <span className="tl-text">
              <span className="tl-name">{selected.end.label ?? "An unnamed road"}</span>
              <span className="tl-sub t-meta muted">{selected.end.kind === "start" ? "Back at the start" : "End"}</span>
            </span>
            <span className="tl-km"><Num value={end.at_m} format={(m) => km(m)} field="stops.at_m" /></span>
            <span className="tl-gap" aria-hidden="true" />
          </li>
        )}
      </ol>
      <EditorDialog open={!!open} title={open?.checkpoint.label ?? ""} onClose={() => setMenu(null)} testId="stop-options">
        {open && menu !== null && (
          <div className="stop-options">
            <Button icon="chevronUp" disabled={menu === 0} onClick={() => { move(menu, menu - 1); setMenu(null); }}>Move earlier</Button>
            <Button icon="chevronDown" disabled={menu === rows.length - 1} onClick={() => { move(menu, menu + 1); setMenu(null); }}>Move later</Button>
            {(open.checkpoint.kind ?? "place") === "place" && (
              <Button icon="mapPin" onClick={() => { toggleReach(open.index); setMenu(null); }}>
                {open.checkpoint.must_reach ? "Pass near instead (within 1 km on foot)" : "Must reach instead (the place itself)"}
              </Button>
            )}
            <Button icon="trash" onClick={() => {
              onEdit({ kind: "remove", list: "checkpoints", index: open.index, label: open.checkpoint.label });
              setMenu(null);
            }}>Remove {open.checkpoint.label}</Button>
          </div>
        )}
      </EditorDialog>
    </>
  );
}
