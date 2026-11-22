/**
 * The HUD and what it says (blueprint Phase 5d amendments 6, 9 and 12). Every number carries data-value. Distances
 * and pace are labelled "along the route", because a shortcut counts as done; the way back is a straight line and
 * says so.
 */
import type { ReactNode } from "react";
import { Num } from "@/components/Num";
import { Icon, IconButton } from "@/components/ui";
import { elapsedMs, elapsedText, gapText, paceSPerKm } from "@/follow/clock";
import { cueAction, cueDistance, NOW_M, nextCue, type Turn } from "@/follow/cues";
import type { Line } from "@/follow/line";
import { cuesOn, signal, type Run } from "@/follow/run";
import { DIRECTIONS, eighth } from "@/plan/direction";
import { km, metres, pace } from "@/plan/format";

type StatProps = { label: string; field: string; value: number | null; format: (value: number) => string };

/** A stat in the pixel font, its unit in the sans, as StatNumber. */
function Stat({ label, field, value, format }: StatProps) {
  const parts = value === null ? [] : format(value).split(/([\d.:]+)/).filter(Boolean);
  return (
    <div className="follow-stat">
      <dt className="t-meta muted">{label}</dt>
      <dd>
        {value === null ? <span className="t-body-s muted">not yet</span> : (
          <span className="stat-number" data-value={value} data-field={field}>
            {parts.map((p, i) => <span key={i} className={/^[\d.:]+$/.test(p) ? "t-stat-xl" : "t-unit"}>{p}</span>)}
          </span>
        )}
      </dd>
    </div>
  );
}

/** Two decimals under 100 km, so it is seen to move. */
const along = (m: number) => km(m, m < 100_000 ? 2 : 1);

export function Stats({ line, run, now, summary }: { line: Line; run: Run; now: number; summary?: boolean }) {
  const elapsed = elapsedMs(run.clock, now);
  const { doneM } = run.track;
  return (
    <dl className="follow-hud" data-testid="follow-stats">
      <Stat label="done, along the route" field="follow.done_m" value={doneM} format={along} />
      {summary
        ? <Stat label="time" field="follow.elapsed_s" value={Math.floor(elapsed / 1000)} format={(s) => elapsedText(s * 1000)} />
        : <Stat label="left, along the route" field="follow.left_m" value={Math.max(0, line.totalM - doneM)} format={along} />}
      {!summary && <Stat label="time" field="follow.elapsed_s" value={Math.floor(elapsed / 1000)} format={(s) => elapsedText(s * 1000)} />}
      <Stat label="pace, along the route" field="follow.pace_s_per_km" value={paceSPerKm(elapsed, doneM)} format={pace} />
    </dl>
  );
}

function cueLine(turns: readonly Turn[], doneM: number): ReactNode {
  const cue = nextCue(turns, doneM);
  if (!cue) return "No more turns. Keep to the line.";
  const action = cueAction(cue.turns);
  if (cue.distanceM < NOW_M) return `Now: ${action}`;
  return <>In <Num value={cue.distanceM} format={cueDistance} field="follow.cue_m" />: {action}</>;
}

export function CueLine({ run, turns, noPosition }: { run: Run; turns: readonly Turn[]; noPosition: boolean }) {
  let text: ReactNode;
  let state: string;
  const said = signal(run);
  if (run.phase === "paused") [state, text] = ["paused", "Paused"];
  else if (noPosition) [state, text] = ["no-position", "No position from your phone just now."];
  else if (said === "finding") [state, text] = ["finding", "Finding you…"];
  else if (said === "weak") [state, text] = ["weak", "GPS is weak"];
  else if (run.track.arrived) [state, text] = ["arrived", "You reached the end. Tap Stop for your summary."];
  else if (cuesOn(run)) [state, text] = ["cue", cueLine(turns, run.track.doneM)];
  else if (said === "off") [state, text] = ["off", "Cues wait until you are back on the route."];
  else if (run.track.status === "elsewhere") [state, text] = ["elsewhere", "On another part of the route. Progress waits."];
  else [state, text] = ["waiting", "Checking where you are…"];
  return (
    <div className="follow-cue">
      <p className="t-heading" data-testid="follow-cue" data-state={state}>{text}</p>
    </div>
  );
}

/** Back from a lock or another app, calmly (amendment 10). It stays until dismissed: it must be readable. */
export function AwayLine({ ms, onDismiss }: { ms: number; onDismiss: () => void }) {
  return (
    <div className="follow-away" role="status" data-testid="follow-away">
      <p className="t-body-s">
        You were away for <Num value={ms} format={gapText} field="follow.away_ms" />. Cues are off while the screen is locked.
      </p>
      <IconButton icon="close" label="Dismiss" onClick={onDismiss} />
    </div>
  );
}

export function OffRouteBanner({ back }: { back: NonNullable<Run["back"]> }) {
  const way = back.bearing === null ? null : DIRECTIONS[eighth(back.bearing)]!.name.toLowerCase();
  return (
    <>
      {/* said once: the distance changes with every fix and would be read out each time */}
      <p role="alert" className="sr-only">You are off the route.</p>
      <div className="follow-off" data-testid="follow-off">
        <Icon name="warning" />
        <p className="t-body-s">
          <strong>You are <Num value={back.offM} format={metres} field="follow.off_m" /> off the route</strong>, in a
          straight line.{way && <> Head <span data-testid="follow-off-way">{way}</span> to get back to it.</>}
        </p>
      </div>
    </>
  );
}
