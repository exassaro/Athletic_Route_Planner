/**
 * Snapping (Phase 5d amendment 8): a loop, an out-and-back, a noisy track, the widened window and the rejoin.
 * The wider measurement is scripts/simulate-follow.mjs (docs/reports/phase5d/follow.md).
 */
import { describe, expect, it } from "vitest";
import { pointAt, type Line } from "./line";
import { lineOf, made, Phone } from "./testing";

/** A whole run; the worst progress error in metres. */
function whole(line: Line, sigma: number, seed = 12345, every = 1) {
  const phone = new Phone(line, 0, seed);
  let worst = 0;
  let banner = false;
  for (let t = 1; 3 * t < line.totalM + 40; t += every) {
    const truth = Math.min(line.totalM, 3 * t);
    const run = phone.on(t, truth, { sigma });
    worst = Math.max(worst, Math.abs(run.track.doneM - truth));
    banner ||= run.off.shown;
  }
  return { worst, banner, phone };
}

describe("a whole run", () => {
  for (const [name, title] of [["S02", "a loop"], ["out_and_back", "an out-and-back"], ["A01", "A01"]] as const) {
    it(`${title}: follows to 100 %`, () => {
      const line = lineOf(name);
      const { worst, banner, phone } = whole(line, 0, 1, 2);
      expect(worst).toBeLessThan(25);
      expect(banner).toBe(false);
      expect(phone.run.track.arrived).toBe(true);
      expect(phone.run.track.doneM).toBe(line.totalM);
    });

    it(`${title}, a noisy track: never 100 m out and no false banner`, () => {
      const { worst, banner, phone } = whole(lineOf(name), 5, 777, 2);
      expect(worst).toBeLessThan(100);
      expect(banner).toBe(false);
      expect(phone.run.track.arrived).toBe(true);
    });
  }

  it("a loop's start is not its finish", () => {
    const phone = new Phone(lineOf("S02"));
    for (let t = 1; t <= 120; t++) expect(phone.on(t, 0, { sigma: 5 }).track.doneM).toBeLessThan(100);
  });

  it("passes that tie go to the expected progress: without that this run is 105 m out", () => {
    expect(whole(lineOf("A01"), 8, 403, 2).worst).toBeLessThan(60);
  });

  it("never goes backwards", () => {
    const line = lineOf("S02");
    const phone = new Phone(line);
    let before = 0;
    for (let t = 1; t < 900; t++) {
      const done = phone.on(t, 3 * t, { sigma: 10 }).track.doneM;
      expect(done).toBeGreaterThanOrEqual(before);
      before = done;
    }
  });

  it("is never a sum of GPS steps: standing in the noise for 10 minutes adds no distance to speak of", () => {
    const phone = new Phone(made([0, 2000]), 500);
    for (let t = 1; t <= 600; t++) phone.on(t, 500, { sigma: 5 });
    expect(phone.run.track.doneM).toBeLessThan(530);
  });

  it("standing just before a turnaround does not jump to the way back", () => {
    for (const seed of [11, 222, 3333, 44444, 555555]) {
      const phone = new Phone(made([0, 1000], [0, -1000]), 940, seed);
      for (let t = 1; t <= 300; t++) phone.on(t, 940, { sigma: 8 });
      expect(phone.run.track.doneM, `seed ${seed}`).toBeLessThan(1000);
    }
  });

  it("a step back for water stays on the route and goes on afterwards", () => {
    const phone = new Phone(made([0, 2000]), 500);
    let t = 0;
    for (let m = 500; m >= 400; m -= 2) expect(phone.on(++t, m).off.shown).toBe(false);
    for (let m = 400; m <= 800; m += 3) expect(phone.on(++t, m).off.shown).toBe(false);
    expect(Math.abs(phone.run.track.doneM - 799)).toBeLessThan(10);
  });

  it("works on fixes too inexact for the banner, and not on useless ones", () => {
    const fair = new Phone(made([0, 2000]));
    for (let t = 1; t <= 100; t++) fair.on(t, 3 * t, { accuracy: 40 });
    expect(fair.run.track.doneM).toBeCloseTo(300, 0);
    const bad = new Phone(made([0, 2000]));
    for (let t = 1; t <= 100; t++) bad.on(t, 3 * t, { accuracy: 120 });
    expect(bad.run.track.doneM).toBe(0);
    expect(bad.run.track.status).toBe("weak");
  });
});

/** 100 m back (or 60) at a walk, a minute standing, then on again: found by searching against broken copies. */
function stepBack(turn: number, sigma: number, back: number) {
  const phone = new Phone(lineOf("S02"), turn - 50, 7);
  let t = 0;
  let m = turn - 50;
  let highest = m;
  let lowered = false;
  const fix = () => {
    const done = phone.on(++t, m, { sigma }).track.doneM;
    lowered ||= done < highest;
    highest = Math.max(highest, done);
  };
  const walk = (to: number, speed: number) => {
    while (Math.abs(to - m) > speed) {
      m += to > m ? speed : -speed;
      fix();
    }
  };
  walk(turn, 3);
  walk(turn - back, 1.5);
  for (let k = 0; k < 60; k++) fix();
  walk(turn + 300, 3);
  return { lowered, outBy: Math.abs(phone.run.track.doneM - m) };
}

describe("a step back on S02, in the noise", () => {
  it("is found again: two followed passes that meet do not tie for ever", () => {
    expect(stepBack(2403, 8, 100).outBy).toBeLessThan(50);
  });

  it("never lowers progress, also when the pass behind catches up", () => {
    expect(stepBack(673, 8, 60).lowered).toBe(false);
  });
});

describe("the widened window after a lock", () => {
  it("on a loop: progress jumps to where the runner is, at the first fix", () => {
    const line = lineOf("S02");
    const phone = new Phone(line, 2000);
    phone.hide(1);
    phone.show(121);
    const run = phone.on(121, 2360);
    expect(run.track.status).toBe("route");
    expect(Math.abs(run.track.doneM - 2360)).toBeLessThan(10);
  });

  it("is 5 m/s x T + 100 m: just inside is found, just beyond is not", () => {
    const inside = new Phone(made([0, 3000]), 500);
    inside.hide(0.001);
    inside.show(60);
    expect(inside.on(60, 500 + 395).track.doneM).toBeCloseTo(895, 0);       // the window is 400 m

    const beyond = new Phone(made([0, 3000]), 500);
    beyond.hide(0.001);
    beyond.show(60);
    const run = beyond.on(60, 500 + 480);                                   // 80 m past it
    expect(run.track.doneM).toBe(500);
    expect(run.track.status).toBe("elsewhere");
    expect(run.off.shown).toBe(false);
  });

  it("shrinks back after three good fixes", () => {
    const phone = new Phone(made([0, 5000]), 500);
    phone.hide(0.001);
    phone.show(120);
    expect(phone.on(120, 700).track.catchUp).toEqual({ untilM: 500 + 5 * 120 + 100, good: 1 });
    expect(phone.on(121, 703).track.catchUp?.good).toBe(2);
    expect(phone.on(122, 706).track.catchUp).toBeNull();
    expect(phone.on(123, 1000).track.doneM).toBeLessThan(720);              // the window is normal again
  });

  it("a loop locked 33 minutes at the start: held while standing, never the finish", () => {
    const line = lineOf("S02");
    for (const seed of [5, 55, 555, 5555]) {
      const phone = new Phone(line, 0, seed);
      phone.hide(0.001);
      phone.show(2010);
      for (let t = 0; t < 120; t++) {
        const run = phone.on(2010 + t, 0, { sigma: 4 });
        expect(run.track.doneM, `seed ${seed}, ${t} s`).toBeLessThan(100);
        expect(run.off.shown).toBe(false);
      }
      for (let t = 1; t <= 40; t++) phone.on(2130 + t, 3 * t, { sigma: 3 });
      expect(Math.abs(phone.run.track.doneM - 120), `seed ${seed}, set off`).toBeLessThan(30);
    }
  });

  it("an out-and-back: two passes are held, then the direction decides, both ways", () => {
    const line = made([0, 2000], [0, -2000]);
    for (const truth of [1700, 2300]) {
      const phone = new Phone(line, 1200);
      phone.hide(0.001);
      phone.show(300);
      const first = phone.on(300, truth, { sigma: 0 });
      expect(first.track.status).toBe("held");
      expect(first.track.doneM).toBe(1200);
      for (let t = 1; t <= 30; t++) phone.on(300 + t, truth + 3 * t);
      expect(Math.abs(phone.run.track.doneM - (truth + 90)), `truth ${truth}`).toBeLessThan(10);
    }
  });

  it("an out-and-back: standing still decides nothing, and expected pace never does", () => {
    const phone = new Phone(made([0, 2000], [0, -2000]), 1200);
    phone.hide(0.001);
    phone.show(300);
    for (let t = 0; t < 180; t++) phone.on(300 + t, 1700, { sigma: 3 });
    expect(phone.run.track.status).toBe("held");
    expect(phone.run.track.doneM).toBe(1200);
  });

  it("standing while the GPS wanders is not a direction", () => {
    const line = lineOf("out_and_back");
    const phone = new Phone(line, 11496, 7);
    phone.hide(0.001);
    phone.show(300);
    const [x, y] = line.toXY(pointAt(line, 11996));
    for (let t = 0; t < 120; t++) {
      const wander = 8 * Math.sin(t / 4);
      expect(phone.at(300 + t, [x + wander, y + wander], { sigma: 3, accuracy: 8 }).track.status, `${t} s`).toBe("held");
    }
  });

  it("goes on after a lock on a stretch with a jog in it", () => {
    const line = made([0, 300], [50, 0], [0, 40], [-50, 0], [0, 900]);
    const phone = new Phone(line, 100);
    phone.hide(0.001);
    phone.show(120);
    for (let t = 0; t <= 120; t++) phone.on(120 + t, 320 + 3 * t);
    expect(phone.run.track.status).toBe("route");
    expect(Math.abs(phone.run.track.doneM - 680)).toBeLessThan(25);
  });
});

describe("off the route", () => {
  it("a rejoin further ahead is found by the growing window, once it has moved along", () => {
    // a U: 800 m north, 300 m east, 800 m south; the shortcut is straight across
    const line = made([0, 800], [300, 0], [0, -800]);
    const phone = new Phone(line, 300);
    let t = 0;
    for (let x = 0; x < 300; x += 3) phone.at(++t, [x, 300]);
    expect(phone.run.track.doneM).toBeLessThan(310);
    let found = -1;
    for (let k = 0; k <= 300 && found < 0; k++) {
      const truth = 1600 + Math.min(3 * k, 300);        // on the third side, heading south
      const run = phone.on(++t, truth);
      if (run.track.status === "route" && Math.abs(run.track.doneM - truth) < 20) found = k;
    }
    expect(found).toBeGreaterThanOrEqual(10);           // not at the first touch: 40 m along first
    expect(phone.run.track.doneM).toBeGreaterThan(1600);
  });

  it("crossing a later part of the route moves nothing", () => {
    const line = made([0, 600], [400, 0], [0, -600]);
    const phone = new Phone(line, 100);
    let t = 0;
    for (let k = 0; k < 400; k++) phone.at(++t, [150, 300]);       // long enough for the window to reach it
    for (let x = 150; x <= 650; x += 3) phone.at(++t, [x, 300]);
    expect(phone.run.track.doneM).toBe(100);
  });
});
