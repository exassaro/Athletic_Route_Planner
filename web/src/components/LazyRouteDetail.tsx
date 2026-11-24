"use client";
/**
 * The elevation chart and km marks, loaded once there is a route to show: not in the first load of "/" (Phase 5e
 * item 6). A chunk that doesn't load says so in their place instead of taking the planner down.
 */
import { useEffect, useState, type ComponentProps, type ComponentType } from "react";
import type { RouteDetail } from "./RouteDetail";

type Props = ComponentProps<typeof RouteDetail>;

let loaded: ComponentType<Props> | null = null;       // a second route doesn't wait a render for it

export function LazyRouteDetail(props: Props) {
  const [Detail, setDetail] = useState<ComponentType<Props> | null>(() => loaded);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Detail) return;
    let live = true;
    import("./RouteDetail").then((m) => {
      loaded = m.RouteDetail;
      if (live) setDetail(() => m.RouteDetail);
    }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [Detail]);
  if (Detail) return <Detail {...props} />;
  return failed ? <p role="alert" className="error-text">The elevation didn&apos;t load. Reload the page to try again.</p> : null;
}
