"use client";
/**
 * The Back gesture during a run asks instead of losing it (blueprint Phase 5d amendment 11). It
 * is one history entry, made in a tap (Chrome skips entries a page makes without one). Back pops it and the screen
 * asks; "Keep going" makes it again. A second Back leaves: it is not a trap, and there is no beforeunload prompt.
 */
import { useCallback, useEffect, useRef } from "react";

const MARK = "gathoRunGuard";

export function useBackGuard(onBack: () => void) {
  const armed = useRef(false);
  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  });
  useEffect(() => {
    // a refresh during a run lands on the entry made before it
    armed.current = !!(window.history.state as Record<string, unknown> | null)?.[MARK];
  }, []);
  useEffect(() => {
    const onPop = () => {
      if (!armed.current) return;
      armed.current = false;
      back.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Call from a tap. */
  const arm = useCallback(() => {
    if (armed.current) return;
    window.history.pushState({ [MARK]: true }, "", window.location.href);
    armed.current = true;
  }, []);

  const disarm = useCallback(() => {
    if (!armed.current) return;
    armed.current = false;
    window.history.back();
  }, []);

  return { arm, disarm };
}
