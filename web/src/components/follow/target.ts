/** Which route /follow follows (blueprint Phase 5d amendment 4). Exactly one of the three, else none. */

export type Target = { kind: "saved" | "route" | "share"; id: string };

export function followTarget(query: Record<string, string | string[] | undefined>): Target | null {
  const found = (["saved", "route", "share"] as const).flatMap((kind) => {
    const id = query[kind];
    return typeof id === "string" && id ? [{ kind, id }] : [];
  });
  return found.length === 1 ? found[0]! : null;
}

/** Where Back and Done lead. */
export function cameFrom(target: Target | null): string {
  if (target?.kind === "saved") return "/routes";
  if (target?.kind === "share") return `/s/${encodeURIComponent(target.id)}`;
  return "/";
}
