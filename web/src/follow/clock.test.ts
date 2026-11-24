/** The run's clock (Phase 5d amendment 10). */
import { describe, expect, it } from "vitest";
import { elapsedMs, elapsedText, gapText, paceSPerKm, pauseClock, resumeClock, startClock, stopClock } from "./clock";

const T0 = 1_795_000_000_000;

describe("the clock", () => {
  it("is the timestamps' difference, whatever happened between", () => {
    expect(elapsedMs(startClock(T0), T0 + 3_723_000)).toBe(3_723_000);
  });

  it("leaves out pauses", () => {
    const paused = pauseClock(startClock(T0), T0 + 60_000);
    expect(elapsedMs(paused, T0 + 500_000)).toBe(60_000);
    expect(elapsedMs(resumeClock(paused, T0 + 180_000), T0 + 200_000)).toBe(80_000);
  });

  it("pausing twice or resuming twice changes nothing", () => {
    const paused = pauseClock(startClock(T0), T0 + 60_000);
    expect(pauseClock(paused, T0 + 90_000)).toBe(paused);
    const resumed = resumeClock(paused, T0 + 90_000);
    expect(resumeClock(resumed, T0 + 99_000)).toBe(resumed);
  });

  it("stands still after stop, and stopping while paused ends it at the pause", () => {
    expect(elapsedMs(stopClock(startClock(T0), T0 + 70_000), T0 + 900_000)).toBe(70_000);
    expect(elapsedMs(stopClock(pauseClock(startClock(T0), T0 + 50_000), T0 + 80_000), T0 + 900_000)).toBe(50_000);
  });

  it("is never below zero when the device's clock steps back", () => {
    expect(elapsedMs(startClock(T0), T0 - 5000)).toBe(0);
  });

  it("pace is time over progress, from 100 m", () => {
    expect(paceSPerKm(1_800_000, 5000)).toBe(360);
    expect(paceSPerKm(30_000, 99)).toBeNull();
  });

  it("reads as a clock", () => {
    expect([0, 307_900, 3_723_000].map(elapsedText)).toEqual(["0:00", "5:07", "1:02:03"]);
  });

  it("says a gap in words", () => {
    expect([45_000, 130_000, 120_000, 3_720_000, 3_600_000].map(gapText))
      .toEqual(["45 s", "2 min 10 s", "2 min", "1 h 2 min", "1 h"]);
  });
});
