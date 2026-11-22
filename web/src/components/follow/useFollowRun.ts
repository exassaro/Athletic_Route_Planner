"use client";
/**
 * The browser's side of a run (blueprint Phase 5d amendments 7 and 10): the position, handed to the pure reducer
 * (src/follow/run.ts) and to nothing else. It is asked for only when Follow is tapped, held in memory, and never
 * sent, stored or logged. The clock shown is read from timestamps; the interval only redraws it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Line } from "@/follow/line";
import { reduceRun, startRun, type Run, type RunEvent } from "@/follow/run";

export type Access =
  | "idle"
  /** Tapped: the permission is asked for, or the first position is on its way. */
  | "asking"
  | "granted"
  | "denied"
  /** Not a secure page (http): browsers give no position there. */
  | "insecure"
  | "unsupported";

const PERMISSION_DENIED = 1;
const TICK_MS = 1000;

export function useFollowRun(line: Line) {
  const [run, setRun] = useState<Run | null>(null);
  const [access, setAccess] = useState<Access>("idle");
  /** The browser can't get a position just now (indoors, no signal). */
  const [noPosition, setNoPosition] = useState(false);
  const [now, setNow] = useState(0);
  const watch = useRef<number | null>(null);

  const unwatch = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }, []);
  useEffect(() => unwatch, [unwatch]);

  const running = run?.phase === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  const send = useCallback((event: RunEvent) => setRun((r) => r && reduceRun(line, r, event)), [line]);

  /** Must be called from the tap: the browser's permission prompt belongs to it. */
  const start = useCallback(() => {
    if (!window.isSecureContext) return setAccess("insecure");
    if (!navigator.geolocation) return setAccess("unsupported");
    unwatch();
    setNoPosition(false);
    setAccess("asking");
    watch.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        const at = Date.now();
        setNow(at);
        setAccess("granted");
        setNoPosition(false);
        const event: RunEvent = { type: "fix", point: [coords.longitude, coords.latitude], accuracy: coords.accuracy,
          at: timestamp, now: at };
        // the run starts with the first position, so the time spent on the prompt is not running time
        setRun((r) => reduceRun(line, r ?? startRun(at), event));
      },
      (error) => {
        if (error.code === PERMISSION_DENIED) {
          unwatch();
          setAccess("denied");
        } else {
          setNoPosition(true);
        }
      },
      { enableHighAccuracy: true, maximumAge: 0 });
  }, [line, unwatch]);

  const cancel = useCallback(() => {
    unwatch();
    setAccess("idle");
    setNoPosition(false);
  }, [unwatch]);

  const act = (type: "pause" | "resume") => {
    const at = Date.now();
    setNow(at);
    send({ type, at });
  };

  const stop = (finished: boolean) => {
    unwatch();
    const at = Date.now();
    setNow(at);
    send({ type: "stop", at, finished });
  };

  return { run, access, noPosition, now, start, cancel, pause: () => act("pause"), resume: () => act("resume"), stop };
}
