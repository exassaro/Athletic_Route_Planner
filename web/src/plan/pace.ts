"use client";
/** The runner's pace, kept in this browser (Phase 5 amendment 5). Default 6:00 /km. */
import { useCallback, useEffect, useState } from "react";

export const PACE_KEY = "athlete.pace_s_per_km";
export const DEFAULT_PACE = 360;

export function usePace(): [number, (secondsPerKm: number) => void] {
  const [pace, setPace] = useState(DEFAULT_PACE);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(PACE_KEY));
      if (saved >= 120 && saved <= 1200) setPace(saved); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {
      /* storage unavailable: keep the default */
    }
  }, []);
  const save = useCallback((s: number) => {
    setPace(s);
    try {
      window.localStorage.setItem(PACE_KEY, String(s));
    } catch {
      /* not saved; still used for this page */
    }
  }, []);
  return [pace, save];
}
