/**
 * The last delete, for its Undo message (blueprint Phase 5c amendment 12). Kept for the tab, so it survives the
 * move from the share page to Saved routes.
 */
export const UNDO_MS = 10_000;
const KEY = "gatho.deleted";

/** `at` tells one message from the next. */
export type Deleted = { savedId: string; name: string; msLeft: number; at: number };

export function newDeleted(savedId: string, name: string): Deleted {
  const deleted = { savedId, name, msLeft: UNDO_MS, at: Date.now() };
  keepDeleted(deleted);
  return deleted;
}

export function keepDeleted(deleted: Deleted) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...deleted, until: Date.now() + deleted.msLeft }));
  } catch {
    /* no storage: the message stays on this page only */
  }
}

/** The delete whose Undo time is not up, else null. */
export function takeDeleted(): Deleted | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { savedId, name, at, until } = JSON.parse(raw);
    const msLeft = until - Date.now();
    if (msLeft > 0) return { savedId, name, at, msLeft };
    sessionStorage.removeItem(KEY);
  } catch {
    /* no storage */
  }
  return null;
}

export function forgetDeleted() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* no storage */
  }
}
