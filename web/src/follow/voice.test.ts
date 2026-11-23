/** Voice cues: which voice, what is said and when (Phase 5d amendment 13). */
import { describe, expect, it } from "vitest";
import { turnsOf, type Turn } from "./cues";
import { announce, pickVoice, SOON_M, type Said, type VoiceLike } from "./voice";
import { ROUTES } from "./testing";

const voice = (lang: string, localService = true, isDefault = false): VoiceLike =>
  ({ lang, localService, default: isDefault, voiceURI: `${lang}-${localService}` });

describe("the voice", () => {
  it("only one on this device: a remote voice is never used, even as the default", () => {
    expect(pickVoice([voice("en-US", false, true), voice("en-GB")], ["en-US"])!.voiceURI).toBe("en-GB-true");
    expect(pickVoice([voice("en-US", false, true)], ["en-US"])).toBeNull();
  });

  it("only English", () => {
    expect(pickVoice([voice("ml-IN"), voice("hi-IN", true, true)], ["ml-IN"])).toBeNull();
  });

  it("the reader's own English first, Android's underscores too, then the default", () => {
    const voices = [voice("en-US", true, true), voice("en_IN"), voice("en-GB")];
    expect(pickVoice(voices, ["en-IN", "ml-IN"])!.lang).toBe("en_IN");
    expect(pickVoice(voices, ["ml-IN"])!.lang).toBe("en-US");
    expect(pickVoice([voice("en-GB"), voice("en-AU")], ["fr-FR"])!.lang).toBe("en-GB");
  });
});

/** Everything said on a run from start to end, one metre at a time. */
function spoken(turns: readonly Turn[], totalM: number): { at: number; text: string }[] {
  let said: Said = null;
  const out: { at: number; text: string }[] = [];
  for (let m = 0; m <= totalM; m += 1) {
    const next = announce(turns, m, said);
    said = next.said;
    if (next.text) out.push({ at: m, text: next.text });
  }
  return out;
}

describe("what is said", () => {
  for (const name of ["A01", "S02", "out_and_back"] as const) {
    const turns = turnsOf(ROUTES[name].cues);
    const total = ROUTES[name].along_m.at(-1)!;
    const lines = spoken(turns, total);

    it(`${name}: every turn is said at it, and the first of each cue before it`, () => {
      // two turns at one place (a zig-zag at a junction) are one line: "Now, turn right, then left."
      const places = turns.filter((t, i) => i === 0 || turns[i - 1]!.at_m !== t.at_m);
      expect(places.length).toBeLessThan(turns.length);
      expect(lines.filter((l) => l.text.startsWith("Now, ")).length).toBe(places.length);
      const firsts = turns.filter((t, i) => i === 0 || turns[i - 1]!.group !== t.group);
      const early = lines.filter((l) => l.text.startsWith("In "));
      // a cue that begins within 100 m of the start is first heard at it
      expect(early.length).toBeGreaterThanOrEqual(firsts.filter((t) => t.at_m >= SOON_M).length);
      expect(early.length).toBeLessThanOrEqual(firsts.length);
    });

    it(`${name}: never further than 100 m, in whole tens, and never the same line twice running`, () => {
      for (const l of lines.filter((x) => x.text.startsWith("In "))) {
        const m = Number(/^In (\d+) metres, turn /.exec(l.text)![1]);
        expect(m % 10).toBe(0);
        expect(m).toBeLessThanOrEqual(SOON_M);
        expect(m).toBeGreaterThanOrEqual(20);
      }
      lines.forEach((l, i) => i && expect(l.text).not.toBe(lines[i - 1]!.text));
    });
  }

  it("a merged cue says its next two turns, and a \"then\" turn is said again only at it", () => {
    const turns: Turn[] = [
      { at_m: 500, turn: "right", road: "Beach Road", group: 0 },
      { at_m: 530, turn: "left", road: null, group: 0 },
      { at_m: 560, turn: "right", road: null, group: 0 },
    ];
    expect(spoken(turns, 700).map((l) => l.text)).toEqual([
      "In 100 metres, turn right onto Beach Road, then left.",
      "Now, turn right onto Beach Road, then left.",
      "Now, turn left, then right.",
      "Now, turn right.",
    ]);
  });

  it("a road named in another script is left out, not spelt out", () => {
    const turns: Turn[] = [{ at_m: 300, turn: "left", road: "\u0d2c\u0d40\u0d1a\u0d4d \u0d31\u0d4b\u0d21\u0d4d", group: 0 },
      { at_m: 900, turn: "right", road: "NH 66", group: 1 }];
    expect(spoken(turns, 1000).map((l) => l.text)).toEqual([
      "In 100 metres, turn left.", "Now, turn left.", "In 100 metres, turn right onto NH 66.", "Now, turn right onto NH 66."]);
  });

  it("a turn first seen close by is said at once, and a jump past it says nothing of it", () => {
    const turns: Turn[] = [{ at_m: 300, turn: "left", road: null, group: 0 }, { at_m: 900, turn: "right", road: null, group: 1 }];
    expect(announce(turns, 250, null).text).toBe("In 50 metres, turn left.");
    expect(announce(turns, 830, { index: 0, stage: "soon" }).text).toBe("In 70 metres, turn right.");
  });
});
