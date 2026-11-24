"use client";
/** "Cleared your run. Undo" (blueprint Phase 5e amendment 3): 10 seconds, paused under the pointer or the focus. */
import { useEffect, useRef, useState } from "react";
import { UNDO_MS } from "@/saved/deleted";
import { Snackbar } from "./ui";

export function ClearedMessage({ onUndo, onGone }: { onUndo: () => void; onGone: () => void }) {
  const [held, setHeld] = useState({ pointer: false, focus: false });
  const left = useRef(UNDO_MS);
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  const paused = held.pointer || held.focus;
  useEffect(() => {
    if (paused) return;
    const since = Date.now();
    const timer = setTimeout(() => gone.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - since));
    };
  }, [paused]);
  return (
    <div onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
      onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
      onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld((h) => ({ ...h, focus: false })); }}>
      <Snackbar testId="cleared-toast" actionLabel="Undo" actionIcon="undo" onAction={onUndo} onDismiss={onGone}>
        Cleared your run.
      </Snackbar>
    </div>
  );
}
