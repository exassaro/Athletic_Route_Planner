/** The next cue (Phase 5d amendment 6), on A01's and S02's real follow responses. */
import { describe, expect, it } from "vitest";
import { cueAction, cueDistance, cueText, nextCue, turnsOf } from "./cues";
import { ROUTES } from "./testing";

const say = (name: "A01" | "S02", doneM: number) => {
  const cue = nextCue(turnsOf(ROUTES[name].cues), doneM);
  return cue && cueText(cue);
};

describe("cues on A01", () => {
  it("has the API's 35 cues and 47 turns", () => {
    expect(ROUTES.A01.cues).toHaveLength(35);
    expect(turnsOf(ROUTES.A01.cues)).toHaveLength(47);
  });

  it("counts down to a named turn", () => {
    expect(say("A01", 3521.3)).toBe("In 300 m: turn right onto Chaliyam Road");
    expect(say("A01", 3810)).toBe("Now: turn right onto Chaliyam Road");
  });

  it("says a turn with no name plainly", () => {
    expect(say("A01", 5800)).toBe("In 250 m: turn right");
  });

  it("says the first two of a merged cue, and then moves along it", () => {
    const merged = ROUTES.A01.cues.find((c) => c.then.length === 2)!;
    const turns = turnsOf(ROUTES.A01.cues);
    expect(cueText(nextCue(turns, merged.at_m - 200)!)).toBe("In 200 m: turn right, then left");
    const second = nextCue(turns, merged.at_m + 10.1)!;
    expect(second.turns.map((t) => t.turn)).toEqual(["left", "right"]);
    expect(cueAction(second.turns)).toBe("turn left, then right onto Chaliyam - Kadalundi - Kottakadavu Road");
  });

  it("says a kilometre and more in km", () => {
    expect(say("A01", 1266.2)).toBe("In 1.2 km: turn right, then left");
  });
});

describe("cues on S02", () => {
  it("has the API's 37 cues and 45 turns", () => {
    expect(ROUTES.S02.cues).toHaveLength(37);
    expect(turnsOf(ROUTES.S02.cues)).toHaveLength(45);
  });

  it("names the second turn of a pair", () => {
    expect(say("S02", 351.7)).toBe("In 300 m: turn right onto Oyitty Road, then left onto Railway Station Road");
  });

  it("the last turn, then none", () => {
    expect(say("S02", 9849.5)).toBe("In 100 m: turn right onto Wayanad Road");
    expect(say("S02", 9965)).toBeNull();
  });
});

describe("nextCue", () => {
  it("keeps a turn until 10 m past it, and never says a distance below zero", () => {
    const turns = turnsOf(ROUTES.S02.cues);
    const first = turns[0]!;
    expect(nextCue(turns, first.at_m + 10)!.turns[0]).toBe(first);
    expect(nextCue(turns, first.at_m + 10)!.distanceM).toBe(0);
    expect(nextCue(turns, first.at_m + 10.1)!.turns[0]).toBe(turns[1]);
  });

  it("only ever counts down between turns", () => {
    for (const name of ["A01", "S02"] as const) {
      const turns = turnsOf(ROUTES[name].cues);
      let last = { at: -1, distance: Infinity };
      for (let m = 0; m < ROUTES[name].along_m.at(-1)!; m += 7) {
        const cue = nextCue(turns, m);
        if (!cue) break;
        expect(cue.turns[0]!.at_m).toBeGreaterThanOrEqual(last.at);
        if (cue.turns[0]!.at_m === last.at) expect(cue.distanceM).toBeLessThanOrEqual(last.distance);
        last = { at: cue.turns[0]!.at_m, distance: cue.distanceM };
      }
    }
  });

  it("a turnaround", () => {
    const turns = turnsOf(ROUTES.out_and_back.cues);
    const around = turns.find((t) => t.turn === "around")!;
    expect(cueAction([around])).toBe("turn around");
  });

  it("rounds to 10 m, then to 0.1 km", () => {
    expect([14.9, 304, 306, 994, 996, 2460].map(cueDistance)).toEqual(["10 m", "300 m", "310 m", "990 m", "1.0 km", "2.5 km"]);
  });

  it("no cues at all is no cue", () => {
    expect(nextCue([], 0)).toBeNull();
  });
});
