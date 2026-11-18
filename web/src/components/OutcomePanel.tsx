"use client";
/**
 * over_budget and conflicts (blueprint Phase 5b amendment 8): one clear headline with the API's numbers, then the
 * fixes as buttons, and no sentence said twice. Every number is the API's; every fix sends the patch the API
 * attached to it (Phase 5 A4). Never a blank map: a conflict keeps the start and the stops on the map.
 *
 * over_budget: "Your stops need 21.7 km" / "1.7 km over your 20.0 km." The solver's own sentence says the same, so
 * it is not shown. A conflict: a fixed title and the solver's sentence, which carries the numbers for that kind.
 */
import type { Schemas } from "@/api/client";
import { km } from "@/plan/format";
import { Num } from "./Num";
import { Button, Icon } from "./ui";

type Version = Schemas["PlanVersionOut"];
type PatchOp = Schemas["PatchOp"];

const TITLES: Record<string, string> = {
  checkpoints_exceed_distance: "Your stops need more than your distance",
  loop_stop_too_far: "A stop is too far for a loop of this distance",
  disconnected: "No walking route connects these places",
  snap_too_far: "A place is too far from any walkable road",
  inside_avoided: "A stop is inside an area you asked to avoid",
};

/** "A", "A or B", "A, B or C" */
export function orList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

export function OutcomePanel({ version, onPatch, disabled }: { version: Version; onPatch: (ops: PatchOp[]) => void; disabled: boolean }) {
  const c = version.conflict;
  if (!c) {
    if (version.outcome === "unsupported") return <div className="outcome warn" role="alert"><p>{version.explanation}</p></div>;
    return null;
  }
  const over = version.outcome === "over_budget";
  const savings = c.savings ?? [];
  const helps = savings.filter((s) => s.patch && s.saves_m > 0);
  const noHelp = savings.filter((s) => s.saves_m <= 0).map((s) => s.label ?? "a stop");
  const dropped = new Set(helps.map((s) => s.label));
  const fixes = (c.fixes ?? []).filter((f) => f.patch && !(f.action === "drop_checkpoint" && dropped.has(f.label)));
  const setDistance = fixes.find((f) => f.action === "set_distance" && f.value_m != null);
  const otherFixes = fixes.filter((f) => f !== setDistance);
  const numbers = over && c.minimum_m != null && c.requested_m != null;

  return (
    <section className={`outcome ${over ? "over" : "conflict"}`} aria-labelledby="outcome-title" data-testid="outcome"
      data-outcome={version.outcome} data-conflict={c.kind}>
      <div className="outcome-head">
        <Icon name="warning" className="outcome-icon" />
        <div>
          {numbers ? (
            <>
              <h2 id="outcome-title" className="t-alert">
                Your stops need <Num value={c.minimum_m!} format={(m) => km(m)} field="conflict.minimum_m" />
              </h2>
              <p className="t-body">
                {c.overshoot_m != null && <><Num value={c.overshoot_m} format={(m) => km(m)} field="conflict.overshoot_m" /> over </>}
                your <Num value={c.requested_m!} format={(m) => km(m)} field="conflict.requested_m" />.
              </p>
            </>
          ) : (
            <>
              <h2 id="outcome-title" className="t-alert">{TITLES[c.kind] ?? "This route can't be made as asked"}</h2>
              <p className="t-body" data-testid="conflict-message">{c.message}</p>
            </>
          )}
        </div>
      </div>

      {setDistance && (
        <Button variant="primary" block disabled={disabled} onClick={() => onPatch(setDistance.patch!)} data-testid="fix-set_distance">
          Change to <Num value={setDistance.value_m!} format={(m) => km(m)} field="conflict.fixes.value_m" />
        </Button>
      )}
      {(helps.length > 0 || otherFixes.length > 0) && (
        <div className="outcome-fixes" role="group" aria-label="Or">
          {helps.map((s) => (
            <Button key={`save-${s.label}`} block disabled={disabled} onClick={() => onPatch(s.patch!)} data-testid={`saving-${s.label}`}
              data-saving={s.label ?? ""} className="outcome-fix">
              <span>Drop {s.label}</span>
              <span className="t-body-s outcome-fix-note">saves <Num value={s.saves_m} format={(m) => km(m)} field="conflict.savings.saves_m" />
                {s.fits && ", then fits"}</span>
            </Button>
          ))}
          {otherFixes.map((f, i) => (
            <Button key={`fix-${i}`} block disabled={disabled} onClick={() => onPatch(f.patch!)}
              data-testid={`fix-${f.action}${f.label ? `-${f.label}` : ""}`} className="outcome-fix">
              {f.action === "drop_checkpoint" ? `Drop ${f.label}` : f.action.replace(/_/g, " ")}
            </Button>
          ))}
        </div>
      )}
      {noHelp.length > 0 && (
        <p className="t-body-s muted">Dropping {orList(noHelp)} doesn&apos;t shorten the run.</p>
      )}
    </section>
  );
}
