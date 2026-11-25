/**
 * "Use on another device" (Step 9, blueprint amendments 2 to 4): this browser asks for a one-time code, shows it
 * as a link and a QR code; the other browser opens `/link#<code>` and claims it.
 *
 * The code goes in the URL fragment, never the query: a fragment is not sent to any server, so it is in no access
 * log and no Referer. `/link` clears it from the address as soon as it has read it.
 */
import type { Schemas } from "@/api/client";
import { call, type PlanClient } from "@/plan/planClient";

export type LinkCode = Schemas["LinkOut"];
export type Claimed = Schemas["SessionOut"];

export const LINK_PATH = "/link";

export function requestLinkCode(client: PlanClient) {
  return call<LinkCode>(() => client.api.POST("/v1/session/link"));
}

/** Claims a code and makes its token this browser's. Throws an ApiFailure (404 link_invalid: unknown, expired, used). */
export async function claimLinkCode(client: PlanClient, code: string): Promise<Claimed> {
  const out = await call<Claimed>(() => client.api.POST("/v1/session/claim", { body: { code } }));
  client.adoptToken(out.token);
  return out;
}

/** The link the other device opens. */
export function linkUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}${LINK_PATH}#${encodeURIComponent(code)}`;
}

/** The code in a location hash ("#abc"), or null. Codes are URL-safe base64: anything else is not one. */
export function codeFromHash(hash: string): string | null {
  let raw = hash.replace(/^#/, "");
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return /^[A-Za-z0-9_-]{16,200}$/.test(raw) ? raw : null;
}

/** "4:59" for a countdown in seconds (never below 0:00). */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
