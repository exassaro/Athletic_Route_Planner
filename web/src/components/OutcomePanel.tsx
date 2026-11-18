"use client";
/**
 * over_budget and conflicts (section 13 error messages, Phase 5 screens). The numbers are the API's; every fix
 * is a one-tap button that sends the patch the API attached to it (Phase 5 A4). Never a blank map: a conflict
 * keeps the start and the stops on the map (useRequestPins) and says what to change.
 */
import type { Schemas } from "@/api/client";
import { km } from "@/plan/format";
import { Num } from "./Num";

type Version = Schemas["PlanVersionOut"];
type PatchOp = Schemas["PatchOp"];

const TITLES: Record<string, string> = {
  checkpoints_exceed_distance: "Your stops need more than your distance",
  loop_stop_too_far: "A stop is too far for a loop of this distance",
  disconnected: "No walking route connects these places",
  snap_too_far: "A place is too far from any walkable road",
  inside_avoided: "A stop is inside an area you asked to avoid",
};

export function OutcomePanel({ version, onPatch, disabled }: { version: Version; onPatch: (ops: PatchOp[]) => void; disabled: boolean }) {
  const c = version.conflict;
  if (!c) {
    if (version.outcome === "unsupported") return <div className="outcome warn" role="alert"><p>{version.explanation}</p></div>;
    return null;
  }
  const over = version.outcome === "over_budget";
  const fixes = (c.fixes ?? []).filter((f) => f.patch);
  const savings = c.savings ?? [];
  return (
    <section className={`outcome ${over ? "over" : "conflict"}`} aria-label="What needs to change" data-testid="outcome"
      data-outcome={version.outcome} data-conflict={c.kind}>
      <h2>{TITLES[c.kind] ?? "This route can't be made as asked"}</h2>
      <p data-testid="conflict-message">{c.message}</p>
      {over && c.minimum_m != null && c.requested_m != null && (
        <p className="numbers">
          Stops need at least <Num value={c.minimum_m} format={(m) => km(m)} field="conflict.minimum_m" />;
          you asked for <Num value={c.requested_m} format={(m) => km(m)} field="conflict.requested_m" />
          {c.overshoot_m != null && <> (<Num value={c.overshoot_m} format={(m) => km(m)} field="conflict.overshoot_m" /> over)</>}.
          Below: the full route through every stop, and the same route cut at your distance.
        </p>
      )}
      {savings.length > 0 && (
        <>
          <h3>Drop a stop</h3>
          <ul className="savings">
            {savings.map((s, i) => (
              <li key={i} data-saving={s.label ?? ""}>
                {s.saves_m <= 0 ? (
                  <span>Dropping {s.label} doesn&apos;t shorten the run.</span>
                ) : (
                  <span>
                    Drop {s.label}: saves <Num value={s.saves_m} format={(m) => km(m)} field="conflict.savings.saves_m" />
                    {s.fits && <span className="good"> · then it fits</span>}
                  </span>
                )}
                {s.patch && s.saves_m > 0 && (
                  <button type="button" disabled={disabled} onClick={() => onPatch(s.patch!)}
                    data-testid={`saving-${s.label}`}>Drop {s.label}</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {fixes.length > 0 && (
        <div className="fixes" role="group" aria-label="Fixes">
          {fixes.map((f, i) => (
            <button key={i} type="button" className="primary" disabled={disabled} onClick={() => onPatch(f.patch!)}
              data-testid={`fix-${f.action}${f.label ? `-${f.label}` : ""}`}>
              {f.action === "set_distance" && f.value_m != null ? <>Change to <Num value={f.value_m} format={(m) => km(m)} field="conflict.fixes.value_m" /></>
                : f.action === "drop_checkpoint" ? `Drop ${f.label}` : f.action.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
