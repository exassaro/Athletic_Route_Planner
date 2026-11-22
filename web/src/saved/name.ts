/** A saved route's name is at most this long (blueprint Phase 5c amendment 3; the API checks it too). */
export const NAME_MAX = 80;

export function displayName(name: string | null): string {
  return name || "Unnamed run";
}

/** As the API counts: trimmed, by code point (an emoji is one). */
export function nameLength(name: string): number {
  return [...name.trim()].length;
}
