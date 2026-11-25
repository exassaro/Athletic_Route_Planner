"use client";
/**
 * "Use on another device" (Step 9, blueprint amendments 2 to 4): a one-time link to this browser's saved routes,
 * as a QR code and as text to copy, valid for 5 minutes, with "New code". Loaded with next/dynamic only when it is
 * opened; the QR encoder is a second import() inside it, so neither is in a page's first load.
 *
 * A modal dialog, mounted only while open, like RenameDialog: Esc closes, the opener takes the focus back.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { asFailure } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";
import { linkUrl, mmss, requestLinkCode } from "@/saved/link";
import type { QrPath } from "@/saved/qr";
import { Button } from "./ui";

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; until: number }
  | { kind: "error"; message: string };

type Props = { onClose: () => void; now?: () => number };

export function LinkDeviceDialog({ onClose, now = Date.now }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [qr, setQr] = useState<QrPath | null>(null);
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const asked = useRef(0);

  const newCode = useCallback(async () => {
    const n = ++asked.current;
    setState({ kind: "loading" });
    setQr(null);
    setCopied(false);
    try {
      const out = await requestLinkCode(planClient());
      if (n !== asked.current) return;
      const url = linkUrl(window.location.origin, out.code);
      setState({ kind: "ready", url, until: now() + out.expires_in_s * 1000 });
      setLeft(out.expires_in_s);
      const { qrPath } = await import("@/saved/qr");
      if (n === asked.current) setQr(qrPath(url));
    } catch (e) {
      if (n === asked.current) setState({ kind: "error", message: asFailure(e).message });
    }
  }, [now]);

  useEffect(() => {
    const d = dialog.current!;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    void newCode(); // eslint-disable-line react-hooks/set-state-in-effect
    const pending = asked;
    return () => { pending.current++; };   // an answer arriving after close is dropped
  }, [newCode]);

  const until = state.kind === "ready" ? state.until : null;
  useEffect(() => {
    if (until === null) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - now()) / 1000)));
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until, now]);

  const expired = state.kind === "ready" && left <= 0;

  const copy = async () => {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.url);
      setCopied(true);
    } catch {
      // no clipboard (http, permissions): select the text so it can be copied by hand
      const field = dialog.current?.querySelector<HTMLInputElement>("input");
      field?.focus();
      field?.select();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <dialog ref={dialog} className="editor link-dialog" aria-labelledby={`${ids}-title`} data-testid="link-dialog"
      onKeyDown={onKeyDown} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="editor-inner">
        <h2 id={`${ids}-title`} className="t-heading">Use on another device</h2>
        <p className="t-body-s">
          Scan this with your phone&apos;s camera, or open the link there. That device will see and change these same
          saved routes. Anyone who has the link in the next 5 minutes can do that too, so keep it to yourself.
        </p>

        {state.kind === "loading" && <p className="muted" role="status">Getting a code…</p>}
        {state.kind === "error" && (
          <p role="alert" className="error-text" data-testid="link-error">Could not get a code. {state.message}</p>
        )}
        {state.kind === "ready" && (
          <>
            <div className={`link-qr${expired ? " expired" : ""}`} data-testid="link-qr" aria-hidden={expired}>
              {qr ? (
                // Always dark on white whatever the theme: phone cameras read inverted codes badly.
                <svg viewBox={`0 0 ${qr.size} ${qr.size}`} width="208" height="208" shapeRendering="crispEdges"
                  role="img" aria-label="QR code of the link below">
                  <rect width={qr.size} height={qr.size} fill="#fff" />
                  <path d={qr.d} fill="#000" />
                </svg>
              ) : <span className="muted">Drawing the code…</span>}
            </div>
            <div className="link-url">
              <label htmlFor={`${ids}-url`} className="field-label">Link</label>
              <input id={`${ids}-url`} readOnly value={expired ? "" : state.url} placeholder="Expired"
                onFocus={(e) => e.currentTarget.select()} data-testid="link-url" />
            </div>
            <p className="t-meta" role="timer" aria-live="off" data-testid="link-countdown" data-value={left}>
              {expired ? "This code has expired." : <>Works for <span className="tabular">{mmss(left)}</span>, once.</>}
            </p>
            <p className="sr-only" aria-live="polite">{expired ? "This code has expired. Ask for a new code." : ""}</p>
          </>
        )}

        <div className="rename-actions">
          {state.kind === "ready" && !expired && (
            <Button icon="copy" onClick={copy} data-testid="link-copy">{copied ? "Copied" : "Copy link"}</Button>
          )}
          <Button icon="redo" onClick={() => void newCode()} disabled={state.kind === "loading"} data-testid="link-new">
            New code
          </Button>
          <Button variant="primary" onClick={onClose} data-testid="link-close">Done</Button>
        </div>
      </div>
    </dialog>
  );
}
