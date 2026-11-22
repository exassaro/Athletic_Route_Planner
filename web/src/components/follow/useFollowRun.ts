"use client";
/**
 * The browser's side of a run (blueprint Phase 5d amendments 7 and 10): the position, handed to the pure reducer
 * (src/follow/run.ts) and to nothing else. It is asked for only when Follow is tapped, held in memory, and never
 * sent, stored or logged. The clock shown is read from timestamps; the interval only redraws it.
 * A locked or hidden page gets no fixes: hiding and showing are told to the reducer, and on showing one fresh
 * position is asked for at once.
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
/** The first position after a wake or a resume. */
const FRESH: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 };

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

  const onPosition = useCallback(({ coords, timestamp }: GeolocationPosition) => {
    if (watch.current === null) return;      // stopped or cancelled: a late answer is not used
    const at = Date.now();
    setNow(at);
    setAccess("granted");
    setNoPosition(false);
    const event: RunEvent = { type: "fix", point: [coords.longitude, coords.latitude], accuracy: coords.accuracy,
      at: timestamp, now: at };
    const showing = document.visibilityState !== "hidden";
    // the run starts with the first position on a showing page, so the time spent on the prompt is not running time
    setRun((r) => (r || showing ? reduceRun(line, r ?? startRun(at), event) : r));
  }, [line]);

  const onPositionError = useCallback((error: GeolocationPositionError) => {
    if (error.code === PERMISSION_DENIED) {
      unwatch();
      setAccess("denied");
    } else {
      setNoPosition(true);
    }
  }, [unwatch]);

  const findNow = useCallback(() => {
    if (watch.current === null) return;
    navigator.geolocation.getCurrentPosition(onPosition, onPositionError, FRESH);
  }, [onPosition, onPositionError]);

  // The screen lock, or another app in front (amendment 10)
  const live = !!run && run.phase !== "stopped";
  useEffect(() => {
    if (!live) return;
    const onVisibility = () => {
      const at = Date.now();
      setNow(at);
      if (document.visibilityState === "hidden") return send({ type: "hidden", at });
      setNoPosition(false);           // "Finding you..." until the answer, not an error from before
      send({ type: "visible", at });
      if (running) findNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [live, running, send, findNow]);

  /** Must be called from the tap: the browser's permission prompt belongs to it. */
  const start = useCallback(() => {
    if (!window.isSecureContext) return setAccess("insecure");
    if (!navigator.geolocation) return setAccess("unsupported");
    unwatch();
    setNoPosition(false);
    setAccess("asking");
    watch.current = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 0 });
  }, [unwatch, onPosition, onPositionError]);

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

  const resume = () => {
    act("resume");
    findNow();
  };

  return { run, access, noPosition, now, start, cancel, pause: () => act("pause"), resume, stop,
    dismissGap: () => send({ type: "dismissGap" }) };
}
