/** One run: the screen lock, pause and stop, and what the HUD may say (Phase 5d amendments 7 to 10). */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { elapsedMs } from "./clock";
import { cuesOn, justLeft, signal, type Run } from "./run";
import { lineOf, made, Phone } from "./testing";

function running(phone: Phone, from: number, seconds: number, first = 1): Run {
  let run = phone.run;
  for (let t = first; t < first + seconds; t++) run = phone.on(t, from + 3 * (t - first + 1));
  return run;
}

describe("the screen lock", () => {
  it("hidden, visible, a stale fix, then a fresh one 4 s later: no banner, the right jump, the gap's line", () => {
    const line = lineOf("S02");
    const phone = new Phone(line, 1000);
    const before = running(phone, 1000, 10).track.doneM;
    phone.hide(11);
    const woke = phone.show(141);                       // away 2 min 10 s
    expect(woke.finding).toBe(true);
    expect(woke.away).toBe(130_000);
    expect(signal(woke)).toBe("finding");
    expect(cuesOn(woke)).toBe(false);

    const stale = phone.on(12, 1030, { now: 141_000 });
    expect(stale).toBe(woke);                           // discarded whole

    const fresh = phone.on(145, 1400);
    expect(fresh.off.shown).toBe(false);
    expect(fresh.finding).toBe(false);
    expect(fresh.track.doneM).toBeGreaterThan(before + 300);
    expect(Math.abs(fresh.track.doneM - 1400)).toBeLessThan(10);
    expect(fresh.away).toBe(130_000);                   // the line stays until dismissed
    expect(phone.send({ type: "dismissGap" }).away).toBeNull();
  });

  it("discards a fix more than 10 s old, and keeps one of 10", () => {
    const phone = new Phone(made([0, 1000]));
    expect(phone.on(1, 3, { now: 11_001 }).here).toBeNull();
    expect(phone.on(1, 3, { now: 11_000 }).here).not.toBeNull();
  });

  it("discards fixes out of order", () => {
    const phone = new Phone(made([0, 1000]));
    const run = phone.on(5, 15);
    expect(phone.on(4, 12)).toBe(run);
    expect(phone.on(5, 18)).toBe(run);
  });

  it("ignores fixes while hidden, and stops the off-route timer", () => {
    const phone = new Phone(made([0, 1000]), 100);
    for (let t = 1; t <= 8; t++) phone.on(t, 100, { side: 70 });
    expect(phone.run.off.since).not.toBeNull();
    const hidden = phone.hide(9);
    expect(hidden.off.since).toBeNull();
    expect(hidden.hidden).toEqual({ at: 9000, doneM: hidden.track.doneM });
    expect(phone.on(20, 400)).toBe(hidden);
  });

  it("after a wake the banner needs its 10 s again", () => {
    const phone = new Phone(made([0, 2000]), 100);
    for (let t = 1; t <= 8; t++) phone.on(t, 100, { side: 70 });
    phone.hide(9);
    phone.show(50);
    for (let t = 50; t < 60; t++) expect(phone.on(t, 100, { side: 70 }).off.shown).toBe(false);
    expect(phone.on(60, 100, { side: 70 }).off.shown).toBe(true);
  });

  it("says nothing for 30 s away, and counts every longer gap for the summary", () => {
    const phone = new Phone(made([0, 5000]));
    phone.hide(10);
    expect(phone.show(40).away).toBeNull();
    phone.hide(100);
    expect(phone.show(131).away).toBe(31_000);
    phone.hide(200);
    phone.show(330);
    expect(phone.send({ type: "stop", at: 400_000 }).gaps).toEqual([{ at: 100_000, ms: 31_000 }, { at: 200_000, ms: 130_000 }]);
  });

  it("counts the time away", () => {
    const phone = new Phone(made([0, 5000]));
    phone.hide(10);
    expect(elapsedMs(phone.show(310).clock, 310_000)).toBe(310_000);
  });
});

describe("pause, resume and stop", () => {
  it("paused: the dot moves, progress and the clock do not", () => {
    const phone = new Phone(made([0, 5000]));
    const before = running(phone, 0, 20);
    const paused = phone.send({ type: "pause", at: 20_000 });
    const later = phone.on(50, 200);
    expect(later.track.doneM).toBe(before.track.doneM);
    expect(later.here).not.toEqual(paused.here);
    expect(elapsedMs(later.clock, 90_000)).toBe(20_000);
    expect(signal(later)).toBeNull();
    expect(cuesOn(later)).toBe(false);
  });

  it("resumed: finds the runner again with the widened window", () => {
    const phone = new Phone(made([0, 5000]));
    running(phone, 0, 20);
    phone.send({ type: "pause", at: 20_000 });
    expect(phone.send({ type: "resume", at: 120_000 }).finding).toBe(true);
    expect(phone.on(121, 400).track.doneM).toBeCloseTo(400, 0);
  });

  it("a lock while paused is no gap", () => {
    const phone = new Phone(made([0, 5000]));
    phone.send({ type: "pause", at: 10_000 });
    phone.hide(20);
    const run = phone.show(200);
    expect(run.gaps).toEqual([]);
    expect(run.away).toBeNull();
    expect(run.finding).toBe(false);
  });

  it("stopped: nothing moves any more", () => {
    const phone = new Phone(made([0, 5000]));
    running(phone, 0, 20);
    const stopped = phone.send({ type: "stop", at: 21_000 });
    expect(phone.on(30, 90)).toBe(stopped);
    expect(phone.send({ type: "resume", at: 40_000 })).toBe(stopped);
    expect(cuesOn(stopped)).toBe(false);
  });
});

describe("what the HUD may say", () => {
  it("finding until the first fix, then the cue", () => {
    const phone = new Phone(made([0, 1000]));
    expect(signal(phone.run)).toBe("finding");
    const run = phone.on(1, 3);
    expect(signal(run)).toBeNull();
    expect(cuesOn(run)).toBe(true);
  });

  it("weak GPS is said, and no banner is guessed", () => {
    const phone = new Phone(made([0, 1000]), 100);
    for (let t = 1; t <= 30; t++) phone.on(t, 100, { side: 70, accuracy: 35 });
    expect(phone.run.off.shown).toBe(false);
    expect(signal(phone.run)).toBe("weak");
  });

  it("a 60 m detour: the banner at 10 s, once, with the straight line and the way back", () => {
    const phone = new Phone(made([0, 1000]), 100);
    let shownAt: number[] = [];
    for (let t = 1; t <= 30; t++) {
      const before = phone.run;
      if (justLeft(before, phone.on(t, 130, { side: 60 }))) shownAt = [...shownAt, t];
    }
    expect(shownAt).toEqual([11]);
    expect(signal(phone.run)).toBe("off");
    expect(phone.run.back!.offM).toBeCloseTo(60, 0);
    expect(phone.run.back!.bearing).toBeCloseTo(270, 0);
    expect(cuesOn(phone.run)).toBe(false);
  });

  it("another pass of the route is not off the route", () => {
    const phone = new Phone(made([0, 1500], [300, 0], [0, -1500]), 100);
    for (let t = 1; t <= 30; t++) phone.at(t, [300, 200]);     // on the way back, far beyond the window
    expect(phone.run.off.shown).toBe(false);
    expect(cuesOn(phone.run)).toBe(false);
  });
});

describe("the logic itself", () => {
  const files = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "testing.ts");

  it("is six modules", () => {
    expect(files.sort()).toEqual(["clock.ts", "cues.ts", "line.ts", "offRoute.ts", "run.ts", "tracker.ts"]);
  });

  for (const file of files) {
    it(`${file} neither sends, stores, logs nor reads the time`, () => {
      const code = readFileSync(`${__dirname}/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/\b(fetch|localStorage|sessionStorage|indexedDB|console|sendBeacon|XMLHttpRequest|Date\.now|setTimeout|setInterval)\b/);
    });
  }
});
