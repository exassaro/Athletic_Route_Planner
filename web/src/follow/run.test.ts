/** One run: the screen lock, pause and stop, and what the HUD may say (Phase 5d amendments 7 to 10). */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { elapsedMs } from "./clock";
import { cuesOn, justLeft, mayHaveFinished, signal, type Run } from "./run";
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

describe("did you finish?", () => {
  const line = lineOf("S02");

  it("asks at a loop's end after a lock long enough to cover it, and a yes records 100 %", () => {
    const phone = new Phone(line, 8000);
    phone.hide(1);
    phone.show(700);
    phone.on(700, line.totalM);
    phone.run = { ...phone.run, track: { ...phone.run.track, doneM: 8000, arrived: false, matchedAt: 1000 } };
    expect(mayHaveFinished(line, phone.run, 701_000)).toBe(true);
    const stopped = phone.send({ type: "stop", at: 701_000, finished: true });
    expect(stopped.track.doneM).toBe(line.totalM);
    expect(stopped.track.arrived).toBe(true);
  });

  it("asks when held between the start and the finish, and a no keeps the progress", () => {
    const phone = new Phone(line);
    phone.hide(0.001);
    phone.show(2010);
    for (let t = 2010; t < 2030; t++) phone.on(t, 0);
    expect(phone.run.track.status).toBe("held");
    expect(mayHaveFinished(line, phone.run, 2_030_000)).toBe(true);
    expect(phone.send({ type: "stop", at: 2_030_000 }).track.doneM).toBe(0);
  });

  it("asks when not found again yet", () => {
    const phone = new Phone(line);
    phone.hide(0.001);
    phone.show(2010);
    expect(mayHaveFinished(line, phone.run, 2_012_000)).toBe(true);
  });

  it("doesn't ask while standing at the start unlocked, however long", () => {
    const phone = new Phone(line);
    for (let t = 1; t <= 2100; t += 3) phone.on(t, 0);
    expect(mayHaveFinished(line, phone.run, 2_101_000)).toBe(false);
  });

  it("doesn't ask when the window cannot reach the end", () => {
    const phone = new Phone(line);
    phone.hide(0.001);
    phone.show(600);
    expect(mayHaveFinished(line, phone.run, 601_000)).toBe(false);
  });

  it("doesn't ask away from the end", () => {
    const phone = new Phone(line);
    phone.hide(0.001);
    phone.show(2010);
    phone.on(2010, 5000, { side: 300 });
    expect(mayHaveFinished(line, phone.run, 2_011_000)).toBe(false);
  });
});

describe("a skipped part", () => {
  it("is marked after a shortcut", () => {
    // the third side is long: the runner is still moving along it when the window has grown that far
    const line = made([0, 800], [300, 0], [0, -3000]);
    const phone = new Phone(line, 300);
    let t = 0;
    for (let x = 0; x < 300; x += 3) phone.at(++t, [x, 300]);
    for (let k = 0; k <= 600; k++) phone.on(++t, 1600 + 3 * k);
    expect(phone.run.track.doneM).toBeGreaterThan(1600);
    expect(phone.run.track.skipped).toBe(true);
  });

  it("is not marked by ground covered while locked", () => {
    const phone = new Phone(made([0, 5000]), 500);
    phone.hide(1);
    phone.show(300);
    phone.on(300, 1500);
    expect(phone.run.track.doneM).toBeCloseTo(1500, 0);
    expect(phone.run.track.skipped).toBe(false);
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

  it("is seven modules", () => {
    expect(files.sort()).toEqual(["clock.ts", "cues.ts", "kept.ts", "line.ts", "offRoute.ts", "run.ts", "tracker.ts"]);
  });

  for (const file of files) {
    it(`${file} neither sends, stores, logs nor reads the time`, () => {
      const code = readFileSync(`${__dirname}/${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code).not.toMatch(/\b(fetch|localStorage|sessionStorage|indexedDB|console|sendBeacon|XMLHttpRequest|Date\.now|setTimeout|setInterval)\b/);
    });
  }
});
