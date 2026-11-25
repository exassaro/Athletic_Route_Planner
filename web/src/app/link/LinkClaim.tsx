"use client";
/**
 * /link#<code> (Step 9, blueprint amendment 4): this browser joins the client that made the code.
 *
 * The code is read from the fragment once and the fragment is cleared at once (replaceState), before any request,
 * so it never stays in the address, the history or a bookmark. It is then kept in memory only, so "Try again"
 * after a network failure can still use it.
 *
 * A browser that already has saved routes of its own is warned first: after linking they are not shown here any
 * more. Nothing is deleted on the server, and its old token is kept aside (PREVIOUS_TOKEN_KEY).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { apiSaid, asFailure } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";
import { listSaved } from "@/saved/api";
import { claimLinkCode, codeFromHash, LINK_PATH } from "@/saved/link";
import { markLinked } from "@/saved/linked";

type State =
  | { kind: "checking" }
  | { kind: "no-code" }
  | { kind: "confirm"; own: number }
  | { kind: "claiming" }
  | { kind: "invalid" }
  | { kind: "offline" }
  | { kind: "failed"; message: string };

export function LinkClaim() {
  const router = useRouter();
  const code = useRef<string | null | undefined>(undefined);
  const started = useRef(false);
  const [state, setState] = useState<State>({ kind: "checking" });

  const claim = useCallback(async () => {
    if (!code.current) return;
    setState({ kind: "claiming" });
    try {
      await claimLinkCode(planClient(), code.current);
      code.current = null;                      // used: never sent twice
      markLinked();
      router.replace("/routes");
    } catch (e) {
      const f = asFailure(e);
      if (apiSaid(e, 404) && f.code === "link_invalid") {
        code.current = null;
        setState({ kind: "invalid" });
      } else if (f.status === 0) setState({ kind: "offline" });
      else setState({ kind: "failed", message: f.message });
    }
  }, [router]);

  /** Warn first when this browser has saved routes of its own; otherwise claim straight away. */
  const start = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setState({ kind: "offline" });
      return;
    }
    const client = planClient();
    if (client.hasToken()) {
      let own = 0;
      try {
        own = (await listSaved(client)).length;
      } catch (e) {
        if (asFailure(e).status === 0) {
          setState({ kind: "offline" });
          return;
        }
        // 401 (unknown token): nothing of its own to lose. Anything else: claim anyway, the claim reports it.
      }
      if (own > 0) {
        setState({ kind: "confirm", own });
        return;
      }
    }
    await claim();
  }, [claim]);

  useEffect(() => {
    if (started.current) return;            // React strict mode runs effects twice: read and claim once
    started.current = true;
    code.current = codeFromHash(window.location.hash);
    if (window.location.hash) window.history.replaceState(window.history.state, "", LINK_PATH);
    if (!code.current) setState({ kind: "no-code" });
    else void start();
  }, [start]);

  return (
    <main className="saved-page link-page" data-testid="link-page" data-state={state.kind}>
      <p className="brand-row"><Link href="/" aria-label="GATHO: plan a run"><Wordmark height={28} /></Link></p>
      <h1 className="t-title">Link this device</h1>

      {(state.kind === "checking" || state.kind === "claiming") && (
        <p role="status" className="muted">Linking…</p>
      )}

      {state.kind === "confirm" && (
        <div role="alert" className="opening-note" data-testid="link-confirm">
          <p className="t-body-s">
            This browser has {state.own === 1 ? "1 saved route" : `${state.own} saved routes`} of its own. After
            linking, this browser shows the other device&apos;s saved routes instead, and{" "}
            {state.own === 1 ? "that route" : "these"} won&apos;t be shown here any more. Nothing is deleted.
          </p>
          <div className="row">
            <Button variant="primary" onClick={() => void claim()} data-testid="link-anyway">Link anyway</Button>
            <Link className="btn btn-secondary" href="/routes" data-testid="link-cancel">Cancel</Link>
          </div>
        </div>
      )}

      {state.kind === "invalid" && (
        <div role="alert" className="opening-note" data-testid="link-invalid">
          <p className="t-body-s">
            This link has expired or was already used. On your other device, open Saved routes, choose &quot;Use on
            another device&quot; and tap &quot;New code&quot;.
          </p>
          <div className="row"><Link className="btn btn-secondary" href="/">Plan a run</Link></div>
        </div>
      )}

      {state.kind === "no-code" && (
        <div className="opening-note" data-testid="link-no-code">
          <p className="t-body-s">
            There is no code in this link. On your other device, open Saved routes and choose &quot;Use on another
            device&quot;.
          </p>
          <div className="row"><Link className="btn btn-secondary" href="/">Plan a run</Link></div>
        </div>
      )}

      {(state.kind === "offline" || state.kind === "failed") && (
        <div role="alert" className="opening-note" data-testid="link-failed">
          <p className="t-body-s">
            {state.kind === "offline" ? "You seem to be offline. Connect, then try again." : `Linking didn't work. ${state.message}`}
          </p>
          <div className="row">
            <Button icon="redo" onClick={() => void start()} data-testid="link-retry">Try again</Button>
            <Link className="btn btn-secondary" href="/">Plan a run</Link>
          </div>
        </div>
      )}

      {state.kind !== "confirm" && state.kind !== "checking" && state.kind !== "claiming" && <Mascot />}
    </main>
  );
}
