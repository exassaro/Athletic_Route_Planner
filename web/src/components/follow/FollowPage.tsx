"use client";
/** /follow: the route is fetched, once, and then followed (blueprint Phase 5d amendment 4). */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui";
import { FollowScreen } from "./FollowScreen";
import { isGone, loadFollow, type Followed } from "./load";
import { cameFrom, type Target } from "./target";

type Loaded = { kind: "loading" } | { kind: "ready"; followed: Followed } | { kind: "gone" } | { kind: "failed"; message: string };

export function FollowPage({ target }: { target: Target | null }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const kind = target?.kind;
  const id = target?.id;
  useEffect(() => {
    let live = true;
    loadFollow(kind && id ? { kind, id } : null).then(
      (followed) => { if (live) setLoaded({ kind: "ready", followed }); },
      (e: Error) => { if (live) setLoaded(isGone(e) ? { kind: "gone" } : { kind: "failed", message: e.message }); });
    return () => { live = false; };
  }, [kind, id, attempt]);

  // from the planner this is a tab of its own: closing it shows the plan again
  const leave = () => {
    if (kind === "route" && window.history.length <= 1) window.close();
    window.location.assign(cameFrom(target));
  };

  if (loaded.kind === "ready") return <FollowScreen followed={loaded.followed} onLeave={leave} />;
  return (
    <main className="dead-link" data-testid="follow-page" data-state={loaded.kind}>
      {loaded.kind === "loading" ? <p className="t-body-s muted" role="status">Loading the route…</p> : (
        <>
          <Mascot />
          <h1 className="t-title">{loaded.kind === "gone" ? "That route is no longer available" : "The route didn't load"}</h1>
          <p className="t-body-s">
            {loaded.kind === "gone"
              ? "It may have been deleted, or it belongs to another browser. A share link can be followed from any browser."
              : loaded.message}
          </p>
          {loaded.kind === "failed" && (
            <Button icon="redo" onClick={() => { setLoaded({ kind: "loading" }); setAttempt((n) => n + 1); }}>Try again</Button>
          )}
          <Link className="btn btn-secondary" href="/" prefetch={false}>Plan a run</Link>
        </>
      )}
    </main>
  );
}
