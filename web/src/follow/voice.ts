/**
 * Voice cues (blueprint Phase 5d amendment 13): what is said, when, and by which voice. English only, and only an
 * on-device voice (`localService`), because a remote voice sends the text away. Pure: the browser's speech is in
 * src/components/follow/useVoice.ts.
 *
 * Each turn is said at most twice: within 100 m ("In 90 metres, turn left onto Beach Road.") and at it ("Now, turn
 * left."). A merged cue says its first two turns, as the screen does; a turn that was already said as the "then"
 * of the one before is said again only at it.
 */
import { nextCue, NOW_M, type Turn } from "./cues";

export const SOON_M = 100;

type Stage = "soon" | "now";
/** The last turn said, by its index in the list, and how. */
export type Said = { index: number; stage: Stage } | null;

export type VoiceLike = { lang: string; localService: boolean; default: boolean; voiceURI: string };

const lang = (tag: string) => tag.replace("_", "-").toLowerCase();

/** An English voice on this device, the reader's own English first; null when there is none. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], preferred: readonly string[]): V | null {
  const local = voices.filter((v) => v.localService && /^en(-|$)/.test(lang(v.lang)));
  for (const tag of preferred.map(lang)) {
    const same = local.find((v) => lang(v.lang) === tag);
    if (same) return same;
  }
  return local.find((v) => v.default) ?? local[0] ?? null;
}

// a name in another script would be spelt out, or skipped, by an English voice
const READABLE = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]+$/u;

function words({ turn, road }: Pick<Turn, "turn" | "road">): string {
  return road && READABLE.test(road) ? `${turn} onto ${road}` : turn;
}

/** What is said next as progress moves, or null; and what has then been said. */
export function announce(turns: readonly Turn[], doneM: number, before: Said): { said: Said; text: string | null } {
  const quiet = { said: before, text: null };
  const cue = nextCue(turns, doneM);
  if (!cue || cue.distanceM > SOON_M) return quiet;
  const index = turns.indexOf(cue.turns[0]!);
  const stage: Stage = cue.distanceM < NOW_M ? "now" : "soon";
  if (before && (index < before.index || (index === before.index && (before.stage === "now" || stage === "soon")))) return quiet;
  // already told as the "then" of the turn before it
  if (stage === "soon" && index > 0 && turns[index - 1]!.group === turns[index]!.group) return quiet;
  const action = `turn ${cue.turns.map(words).join(", then ")}`;
  const text = stage === "now" ? `Now, ${action}.` : `In ${Math.round(cue.distanceM / 10) * 10} metres, ${action}.`;
  return { said: { index, stage }, text };
}
