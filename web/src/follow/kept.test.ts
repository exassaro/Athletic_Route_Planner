/** What a tab keeps of a run, and the run it gives back (Phase 5e amendment 6). */
import { describe, expect, it } from "vitest";
import { elapsedMs } from "./clock";
import { keepRun, resumeRun, RUN_MAX_AGE_MS } from "./kept";
import { pointAt } from "./line";
import { reduceRun, startRun, type Run } from "./run";
import { lineOf, Phone } from "./testing";

const line = lineOf("A01");
const T0 = 1_795_000_000_000;
const at = (seconds: number) => T0 + seconds * 1000;

function fix(run: Run, seconds: number, m: number): Run {
  return reduceRun(line, run, { type: "fix", point: pointAt(line, m), accuracy: 6, at: at(seconds), now: at(seconds) });
}

function ran(seconds: number): Run {
  let run = startRun(T0);
  for (let t = 0; t <= seconds; t += 5) run = fix(run, t, t * 3);
  return run;
}

const back = (run: Run, seconds: number) => resumeRun(line, "r1", keepRun("r1", run), at(seconds));

describe("what is kept", () => {
  it("metres done, the start time and the pauses, with the route and nothing else", () => {
    const text = keepRun("r1", ran(600));
    expect(Object.keys(JSON.parse(text)).sort())
      .toEqual(["doneM", "pausedAt", "pausedMs", "route", "schema", "startedAt", "stopped"]);
  });

  it("no coordinate and no time of the last fix", () => {
    const run = ran(600);
    const text = keepRun("r1", run);
    for (const n of run.here!.point) expect(text).not.toContain(String(n).slice(0, 7));
    expect(text).not.toContain(String(run.lastFixAt));
  });

  it("the same text while only a fix or the screen changes", () => {
    const paused = reduceRun(line, ran(600), { type: "pause", at: at(600) });
    expect(keepRun("r1", fix(paused, 610, 1900))).toBe(keepRun("r1", paused));
  });
});

describe("the run it gives back", () => {
  it("a running one: the metres and the time, finding the runner", () => {
    const run = ran(600);
    const got = back(run, 620)!;
    expect([got.phase, got.finding, got.resumed, got.here]).toEqual(["running", true, true, null]);
    expect(got.track.doneM).toBe(run.track.doneM);
    expect(elapsedMs(got.clock, at(620))).toBe(620_000);
  });

  it("the window reaches a runner who ran on while away", () => {
    for (const away of [5, 60, 600]) {
      const got = back(ran(600), 600 + away)!;
      const next = fix(got, 600 + away, 1800 + 3 * away);
      expect(Math.abs(next.track.doneM - (1800 + 3 * away)), `${away} s`).toBeLessThan(30);
      expect(next.track.skipped).toBe(false);
    }
  });

  it("at a loop's start a refresh never jumps to the finish", () => {
    const loop = lineOf("S02");
    const phone = new Phone(loop);
    phone.run = resumeRun(loop, "s", keepRun("s", startRun(0)), 2400_000)!;
    for (let t = 2400; t < 2460; t++) phone.on(t, 0, { sigma: 4 });
    expect(phone.run.track.doneM).toBeLessThan(50);
  });

  it("pauses, closed and open", () => {
    let run = reduceRun(line, ran(600), { type: "pause", at: at(600) });
    run = reduceRun(line, run, { type: "resume", at: at(660) });
    expect(elapsedMs(back(run, 700)!.clock, at(700))).toBe(640_000);
    run = reduceRun(line, run, { type: "pause", at: at(700) });
    const got = back(run, 900)!;
    expect([got.phase, got.finding]).toEqual(["paused", false]);
    expect(elapsedMs(got.clock, at(900))).toBe(640_000);
  });

  it("a stopped one is stopped at the same time, and can't be carried on", () => {
    for (const paused of [false, true]) {
      let run = ran(600);
      if (paused) run = reduceRun(line, run, { type: "pause", at: at(600) });
      const stopped = reduceRun(line, run, { type: "stop", at: at(650) });
      const got = back(stopped, 900)!;
      expect(got.phase).toBe("stopped");
      expect(elapsedMs(got.clock, at(900))).toBe(elapsedMs(stopped.clock, at(900)));
      expect(reduceRun(line, got, { type: "resume", at: at(901) })).toBe(got);
      expect(keepRun("r1", got)).toBe(keepRun("r1", stopped));
    }
  });

  it("a finished one is still finished", () => {
    const done = reduceRun(line, ran(600), { type: "stop", at: at(650), finished: true });
    expect(back(done, 700)!.track.arrived).toBe(true);
  });
});

describe("reading it back never throws", () => {
  const good = JSON.parse(keepRun("r1", ran(60)));
  const bad: [string, string | null][] = [
    ["nothing", null], ["not JSON", "{oops"], ["null", "null"], ["a number", "7"],
    ...Object.entries({
      "another schema": { schema: 2 }, "another route": { route: "r2" }, "past the end": { doneM: line.totalM + 1 },
      "no metres": { doneM: null }, "a start to come": { startedAt: at(900) }, "a bad pause": { pausedAt: T0 - 1 },
      "a negative pause": { pausedMs: -1 }, "stopped, but when": { stopped: true }, "no mark": { stopped: "yes" },
    }).map(([name, change]): [string, string] => [name, JSON.stringify({ ...good, ...change })]),
  ];
  for (const [name, text] of bad) it(`${name}: no run`, () => expect(resumeRun(line, "r1", text, at(120))).toBeNull());

  it("12 hours old is too old", () => {
    const text = JSON.stringify(good);
    expect(resumeRun(line, "r1", text, T0 + RUN_MAX_AGE_MS - 1)).not.toBeNull();
    expect(resumeRun(line, "r1", text, T0 + RUN_MAX_AGE_MS)).toBeNull();
  });
});
