/**
 * The planner's address and this tab's storage (blueprint Phase 5e amendments 1 and 2). The address is the truth
 * for a computed plan: /?plan=<plan_id>&v=<version>&r=<candidate>, with &edit=<saved_id> while one is edited.
 */
import { DRAFT_KEY, parseStored, type RunPointer, type Stored } from "./draft";

export type Address =
  | { kind: "plan"; run: Omit<RunPointer, "history" | "seq"> & { seq: number | null } }
  | { kind: "edit"; id: string }
  | null;

export function readAddress(search: string): Address {
  const query = new URLSearchParams(search);
  const plan = query.get("plan");
  const edit = query.get("edit") || null;
  const version = Number(query.get("v"));
  if (plan && Number.isInteger(version) && version >= 1) {
    const r = query.get("r");
    const seq = r && /^\d+$/.test(r) ? Number(r) : null;
    return { kind: "plan", run: { plan, version, seq, edit } };
  }
  return edit ? { kind: "edit", id: edit } : null;
}

export function planAddress(run: Omit<RunPointer, "history">): string {
  // edit stays last, as the links that open a saved route write it
  const edit = run.edit ? `&edit=${encodeURIComponent(run.edit)}` : "";
  return `/?plan=${encodeURIComponent(run.plan)}&v=${run.version}&r=${run.seq}${edit}`;
}

export function readTab(now: number): Stored | null {
  try {
    return parseStored(window.sessionStorage.getItem(DRAFT_KEY), now);
  } catch {
    return null;            // no storage
  }
}

export function clearTab() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* no storage */
  }
}

export const WRITE_AFTER_MS = 300;

/** Writes the latest text 300 ms after the last change, when idle; `flush` writes it now. */
export function tabWriter() {
  let pending: (() => string | null) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const make = pending;
    pending = null;
    if (!make) return;
    const text = make();
    if (text === null) return clearTab();
    try {
      window.sessionStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* full or unavailable: it is kept on this page only */
    }
  };
  return {
    flush,
    /** `make` gives the text, or null for nothing to keep. */
    schedule(make: () => string | null) {
      pending = make;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(flush, { timeout: 1000 });
        else flush();
      }, WRITE_AFTER_MS);
    },
  };
}
