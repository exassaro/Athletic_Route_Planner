/**
 * "Linked. Your saved routes are here" (Step 9): /link sets a mark in this tab, /routes shows the message once and
 * takes the mark away. sessionStorage, so it never outlives the tab; a storage failure just loses the message.
 */
const KEY = "gatho:linked";

export function markLinked(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* no storage: no message */
  }
}

/** Whether this tab was just linked (within a minute); the mark is removed either way. */
export function takeLinked(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    sessionStorage.removeItem(KEY);
    return at > 0 && now - at < 60_000;
  } catch {
    return false;
  }
}
