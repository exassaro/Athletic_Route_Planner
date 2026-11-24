"use client";
/**
 * The browser's speech for voice cues (blueprint Phase 5d amendment 13). Off by default and offered only when the
 * device has an English voice of its own. It speaks only while cues show (src/follow/run.ts `cuesOn`), and stops
 * mid-sentence on pause, stop, the screen lock or leaving the route. Nothing is stored: a refresh turns it off.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Turn } from "@/follow/cues";
import { cuesOn, type Run } from "@/follow/run";
import { announce, pickVoice, type Said } from "@/follow/voice";

const speech = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

function subscribe(changed: () => void) {
  const synth = speech();
  synth?.addEventListener?.("voiceschanged", changed);
  const again = setTimeout(changed, 1000);        // a browser that loads its voices and says nothing
  return () => {
    synth?.removeEventListener?.("voiceschanged", changed);
    clearTimeout(again);
  };
}

const languages = () => (navigator.languages?.length ? navigator.languages : [navigator.language]);
const chosen = () => {
  const synth = speech();
  return synth ? pickVoice(synth.getVoices(), languages()) : null;
};

export function useVoice(turns: readonly Turn[], run: Run | null) {
  // the voice's id: a string, so the store's snapshot is stable
  const voiceId = useSyncExternalStore(subscribe, () => chosen()?.voiceURI ?? "", () => "");
  const [on, setOn] = useState(false);
  const said = useRef<Said>(null);

  const speak = useCallback((text: string) => {
    const synth = speech();
    const voice = chosen();
    if (!synth || !voice) return;           // never the default voice, which may be a remote one
    try {
      const line = new SpeechSynthesisUtterance(text);
      line.voice = voice;
      line.lang = voice.lang;
      if (synth.speaking || synth.pending) synth.cancel();      // the newest cue, never a queue of old ones
      synth.speak(line);
    } catch {
      // a speech engine that fails must not take the run with it: the cue is on the screen
    }
  }, []);

  const quiet = !on || !run || run.phase !== "running" || !!run.hidden || run.off.shown;
  useEffect(() => {
    if (quiet) speech()?.cancel();
  }, [quiet]);
  useEffect(() => () => speech()?.cancel(), []);

  useEffect(() => {
    if (!on || !run || !cuesOn(run)) return;
    const next = announce(turns, run.track.doneM, said.current);
    said.current = next.said;
    if (next.text) speak(next.text);
  }, [on, run, turns, speak]);

  /** From a tap: a browser speaks only after one. */
  const toggle = () => {
    const next = !on;
    setOn(next);
    if (!next) return;
    said.current = null;
    speak("Voice cues on.");
  };

  return { available: voiceId !== "", on: on && voiceId !== "", toggle };
}
