"use client";
/**
 * The screen stays on during a run, with the Screen Wake Lock API (blueprint Phase 5d amendments 10 and 11). The
 * browser takes the lock away whenever the page is hidden, so it is asked for again when it shows. A browser that
 * has none, or refuses, is said in one line; the run goes on.
 */
import { useEffect, useState } from "react";

export type ScreenLock = "off" | "on" | "unsupported" | "refused";

export const WAKE_NOTICE: Record<Exclude<ScreenLock, "off" | "on">, string> = {
  unsupported: "This browser can't keep the screen on. Set a longer screen timeout on your phone.",
  refused: "Your phone won't keep the screen on just now (battery saving does this). It may lock.",
};

export function useWakeLock(active: boolean): ScreenLock {
  const [state, setState] = useState<ScreenLock>("off");
  useEffect(() => {
    if (!active) return;
    let over = false;
    let asking = false;
    let held: WakeLockSentinel | null = null;

    const released = () => {
      held = null;
      // taken away while showing (low battery): hidden is normal, and is asked again on showing
      if (!over && document.visibilityState === "visible") setState("refused");
    };
    const ask = async () => {
      if (over || asking || held || document.visibilityState !== "visible") return;
      if (!("wakeLock" in navigator) || !navigator.wakeLock) return setState("unsupported");
      asking = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (over) return void lock.release().catch(() => {});
        held = lock;
        lock.addEventListener("release", released);
        setState("on");
      } catch {
        if (!over) setState("refused");
      } finally {
        asking = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") return void ask();
      // the browser releases it when hidden, and may say so only after the page shows again
      held?.removeEventListener("release", released);
      held = null;
    };

    void ask();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      over = true;
      document.removeEventListener("visibilitychange", onVisibility);
      held?.removeEventListener("release", released);
      held?.release().catch(() => {});
      held = null;
      setState("off");
    };
  }, [active]);
  return state;
}
