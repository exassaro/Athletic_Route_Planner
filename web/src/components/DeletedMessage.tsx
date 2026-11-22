"use client";
/**
 * "Deleted <name>. Its share link stopped working." with Undo (blueprint Phase 5c amendment 12): 10 seconds,
 * paused while it has the pointer or the focus.
 */
import { useEffect, useRef, useState } from "react";
import { keepDeleted, type Deleted } from "@/saved/deleted";
import { Snackbar } from "./ui";

type Props = { deleted: Deleted; onUndo: () => void; onGone: () => void };

export function DeletedMessage({ deleted, onUndo, onGone }: Props) {
  const [held, setHeld] = useState({ pointer: false, focus: false });
  const left = useRef(deleted.msLeft);
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  const paused = held.pointer || held.focus;
  useEffect(() => {
    if (paused) return;
    const since = Date.now();
    keepDeleted({ ...deleted, msLeft: left.current });
    const timer = setTimeout(() => {
      left.current = 0;
      gone.current();
    }, left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - since));
    };
  }, [deleted, paused]);
  return (
    <div className="page-message" data-paused={paused}
      onPointerEnter={() => setHeld((h) => ({ ...h, pointer: true }))}
      onPointerLeave={() => setHeld((h) => ({ ...h, pointer: false }))}
      onFocus={() => setHeld((h) => ({ ...h, focus: true }))}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld((h) => ({ ...h, focus: false })); }}>
      <Snackbar testId="deleted-toast" actionLabel="Undo" actionIcon="undo" onAction={onUndo} onDismiss={onGone}>
        Deleted {deleted.name}. Its share link stopped working.
      </Snackbar>
    </div>
  );
}
