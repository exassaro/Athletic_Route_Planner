/**
 * Talks to the API for the planner: the anonymous session, create and patch with the waiting rules, and reads.
 * Types are the generated ones only (Phase 5 amendment 2).
 *
 * Waiting rules (section 13 states, Phase 4 amendments 3, 12, 19):
 * - 429 solver_busy: wait Retry-After (capped), try again, at most MAX_TRIES sends in all (3 retries), with a
 *   countdown the planner shows and a Cancel (cancelWaiting) (Step 9 amendment 7).
 * - 429 rate_limited: no retry; the failure says how long to wait.
 * - 503 on a solve: "Planning is temporarily unavailable" (the API's reason is kept in detail).
 * - 409 plan_solving: a solve for this plan is running; poll the plan until it is ready, then send again.
 * - 412 version_mismatch: someone (another tab) made a newer version; send again on top of it. The patch's
 *   `test` operations stop a stale removal.
 * - 504 solve_timeout: the solve carries on; poll the plan until the new version appears. Only if that gives up:
 *   "That route took too long; try a shorter distance".
 * - 401: the token is unknown (database reset); get a new one and try once more.
 * An edit of a version that is not the latest (a saved route opened for editing) names it with from_version and
 * sends no If-Match: it is meant to apply to that version whatever the latest is (Phase 5c A11).
 * Anything else is an ApiFailure: with the API's own error code and message, or, when it was not the API that
 * answered (another address, a proxy, no network), saying that instead. `call` is the one way to send a request.
 */
import createClient from "openapi-fetch";
import { API_BASE } from "@/api/client";
import type { components, paths } from "@/api/schema";

type S = components["schemas"];
export type PlanVersion = S["PlanVersionOut"];
export type PlanOut = S["PlanOut"];
export type RouteRequest = S["RouteRequest"];
export type { NewRouteRequest } from "@/api/client";
import type { NewRouteRequest } from "@/api/client";
export type PatchOp = S["PatchOp"];
export type ErrorBody = S["ErrorBody"];

export const TOKEN_KEY = "athlete.token";
/** The token this browser had before it was linked to another device's client (Step 9): kept, never sent. */
export const PREVIOUS_TOKEN_KEY = "athlete.token.previous";
/** Endpoints sent without a token: a visitor never gets a session from them, and claim makes its own. */
const NO_TOKEN = new Set(["/v1/session", "/v1/session/claim", "/v1/health"]);
export const MAX_TRIES = 4;
/** A wait the user cancelled: not an error to show. */
export const CANCELLED = "cancelled";
export const UNAVAILABLE_MESSAGE = "Planning is temporarily unavailable. Try again in a few minutes.";
export const TOO_LONG_MESSAGE = "That route took too long; try a shorter distance.";
const MAX_WAIT_S = 30;
const POLL_EVERY_MS = 1500;
const POLL_FOR_MS = 60_000;

export type Status =
  | { kind: "solving" }
  /** `until`: when the next try is sent (ms since the epoch), for a live countdown. */
  | { kind: "busy"; reason: "solver_busy"; retryInS: number; attempt: number; until: number }
  | { kind: "waiting"; reason: "plan_solving" | "solve_timeout" };

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: unknown) {
    super(message);
  }
}

type Sent = { data?: unknown; error?: unknown; response: Response };

const NOT_HERE = "api_not_here";
const NO_API_ANSWER = "no_api_answer";
const NETWORK = "network";

/**
 * The failure behind an error answer. The API always sends {error, message}; without that something else answered.
 * A 404 or 405 then means the API isn't at this address: typically the same-origin build opened on the web
 * server's own port instead of through the proxy, which is https with no port.
 */
export function apiFailure(status: number, body: unknown, base: string = API_BASE,
  page: Pick<Location, "protocol" | "port" | "hostname"> | undefined = globalThis.location): ApiFailure {
  const b = body as Partial<ErrorBody> | null | undefined;
  if (typeof b?.error === "string" && typeof b.message === "string") return new ApiFailure(status, b.error, b.message, b.detail);
  if (status === 404 || status === 405) {
    const elsewhere = base === "" && page && (page.protocol !== "https:" || page.port !== "");
    return new ApiFailure(status, NOT_HERE,
      `GATHO's API isn't at this address.${elsewhere ? ` Open https://${page.hostname} instead.` : ""}`);
  }
  return new ApiFailure(status, NO_API_ANSWER, `GATHO's API didn't answer properly (${status}).`);
}

/** What a rejected request means: a failure already explained (the session's), or no answer at all (status 0). */
export function asFailure(e: unknown): ApiFailure {
  return e instanceof ApiFailure ? e : new ApiFailure(0, NETWORK, "No answer from GATHO. Check your connection.");
}

/** Whether the API itself gave one of these statuses. Only then does a 404 mean that something is gone. */
export function apiSaid(e: unknown, ...statuses: number[]): boolean {
  return e instanceof ApiFailure && statuses.includes(e.status) && ![NOT_HERE, NO_API_ANSWER, NETWORK].includes(e.code);
}

/** Sends, for a caller that needs the response itself. Rejects only with an ApiFailure. */
export async function answer<R>(send: () => Promise<R>): Promise<R> {
  try {
    return await send();
  } catch (e) {
    throw asFailure(e);
  }
}

/** Sends and returns the body. A 204 has none: success is the response's status, never whether there is data. */
export async function call<T>(send: () => Promise<Sent>): Promise<T> {
  const { data, error, response } = await answer(send);
  if (response.ok) return data as T;
  throw apiFailure(response.status, error);
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** The part of the Web Locks API used here (navigator.locks): one session per browser, across its tabs. */
export type Locks = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
const SESSION_LOCK = "gatho:session";

export type Options = {
  baseUrl: string;
  /** Defaults to navigator.locks where there is one; null: no lock (one tab's own dedupe only). */
  locks?: Locks | null;
  fetch?: typeof globalThis.fetch;
  storage?: Storage | null;
  sleep?: (ms: number) => Promise<void>;
  onStatus?: (s: Status) => void;
};

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** localStorage when it works (private windows and previews may throw), else memory for this page. */
export function browserStorage(): Storage {
  try {
    const s = window.localStorage;
    s.setItem("athlete.probe", "1");
    s.removeItem("athlete.probe");
    return s;
  } catch {
    return memoryStorage();
  }
}

/** "45 seconds", "1 minute", "3 minutes". */
export function waitText(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export class PlanClient {
  readonly api;
  private storage: Storage;
  private sleep: (ms: number) => Promise<void>;
  private onStatus: (s: Status) => void;
  private tokenPromise: Promise<string> | null = null;
  private cancelWait: (() => void) | null = null;

  constructor(private opts: Options) {
    this.storage = opts.storage ?? memoryStorage();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onStatus = opts.onStatus ?? (() => {});
    this.api = createClient<paths>({ baseUrl: opts.baseUrl, fetch: opts.fetch });
    this.api.use({
      onRequest: async ({ request, schemaPath }) => {
        if (NO_TOKEN.has(schemaPath) || schemaPath.startsWith("/v1/share")) return;
        request.headers.set("X-Client-Token", await this.token());
        return request;
      },
    });
  }

  /**
   * This browser's token, made once, when a request first needs one (Step 9 amendment 6). Never on page load: a
   * visitor who only looks gets no session. Calls at the same time in this page share one request (React strict
   * mode, several components); tabs opening together wait on a Web Lock and read the token the first one stored.
   * A failed request stores nothing, and the next call tries again.
   */
  token(): Promise<string> {
    const saved = this.storage.getItem(TOKEN_KEY);
    if (saved) return Promise.resolve(saved);
    this.tokenPromise ??= this.newSession().finally(() => (this.tokenPromise = null));
    return this.tokenPromise;
  }

  private newSession(): Promise<string> {
    const make = async () => {
      const made = this.storage.getItem(TOKEN_KEY);     // another tab made one while this one waited
      if (made) return made;
      const { token } = await call<S["SessionOut"]>(() => this.api.POST("/v1/session"));
      this.storage.setItem(TOKEN_KEY, token);
      return token;
    };
    const locks = this.opts.locks === undefined
      ? (typeof navigator !== "undefined" ? (navigator.locks as Locks | undefined) : undefined)
      : this.opts.locks;
    return locks ? locks.request(SESSION_LOCK, make) : make();
  }

  /** Whether this browser holds a token already (without asking for one). */
  hasToken(): boolean {
    return this.storage.getItem(TOKEN_KEY) !== null;
  }

  /** Uses a token claimed from another device (Step 9). The one it replaces is kept aside, not thrown away. */
  adoptToken(token: string): void {
    const before = this.storage.getItem(TOKEN_KEY);
    if (before && before !== token) this.storage.setItem(PREVIOUS_TOKEN_KEY, before);
    this.storage.setItem(TOKEN_KEY, token);
  }

  /** Runs a create or patch with the waiting rules. `send(version)` gets the version to build on (If-Match). */
  private async solveCall(planId: string | null, send: (ifVersion: number | null) =>
    Promise<Sent>, ifVersion: number | null): Promise<PlanVersion> {
    let version = ifVersion;
    let renewed = false;
    for (let attempt = 1; ; attempt++) {
      this.onStatus({ kind: "solving" });
      const { data, error, response } = await answer(() => send(version));
      if (data) return data as PlanVersion;
      const f = apiFailure(response.status, error);
      const retryAfter = Number(response.headers.get("Retry-After")) ||
        Number((f.detail as { retry_after_s?: number } | undefined)?.retry_after_s) || 0;
      if (response.status === 429 && f.code === "solver_busy") {
        if (attempt >= MAX_TRIES) {
          throw new ApiFailure(429, f.code, "Lots of runners planning right now, and it's still busy. Try again in a minute.",
            f.detail);
        }
        const wait = Math.min(retryAfter || 2 ** attempt, MAX_WAIT_S);
        this.onStatus({ kind: "busy", reason: f.code, retryInS: wait, attempt, until: Date.now() + wait * 1000 });
        await this.waitOrCancel(wait * 1000);
        continue;
      }
      if (response.status === 429 && f.code === "rate_limited") {
        const wait = retryAfter || 60;
        throw new ApiFailure(429, f.code, `Too many plans in a short time. Wait ${waitText(wait)}, then try again.`,
          { ...(typeof f.detail === "object" && f.detail ? f.detail : {}), retry_after_s: wait });
      }
      if (response.status === 503 && f.code !== NOT_HERE && f.code !== NO_API_ANSWER) {
        throw new ApiFailure(503, f.code, UNAVAILABLE_MESSAGE, { reason: f.message, detail: f.detail });
      }
      if (response.status === 401 && !renewed) {
        renewed = true;
        this.storage.removeItem(TOKEN_KEY);
        continue;
      }
      if (planId && ((response.status === 409 && f.code === "plan_solving") || response.status === 412) &&
        attempt < MAX_TRIES) {
        this.onStatus({ kind: "waiting", reason: "plan_solving" });
        const plan = await this.waitForPlan(planId);
        version = plan.latest?.version ?? version;
        continue;
      }
      if (response.status === 504 && f.code === "solve_timeout") {
        const id = planId ?? (f.detail as { plan_id?: string } | undefined)?.plan_id;
        if (!id) throw new ApiFailure(504, f.code, TOO_LONG_MESSAGE, f.detail);
        this.onStatus({ kind: "waiting", reason: "solve_timeout" });
        let plan: PlanOut;
        try {
          plan = await this.waitForPlan(id, ifVersion);
        } catch (e) {
          if (e instanceof ApiFailure && e.code === "solve_timeout") throw new ApiFailure(504, e.code, TOO_LONG_MESSAGE, f.detail);
          throw e;
        }
        if (plan.latest) return plan.latest;
      }
      if (response.status === 504) throw new ApiFailure(504, f.code, TOO_LONG_MESSAGE, f.detail);
      throw f;
    }
  }

  /** Stops a solver_busy wait: the create or patch waiting on it fails with CANCELLED, and nothing is sent. */
  cancelWaiting(): void {
    this.cancelWait?.();
  }

  private waitOrCancel(ms: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let done = false;
      this.cancelWait = () => {
        if (done) return;
        done = true;
        this.cancelWait = null;
        reject(new ApiFailure(0, CANCELLED, "Cancelled. Nothing was changed."));
      };
      void this.sleep(ms).then(() => {
        if (done) return;
        done = true;
        this.cancelWait = null;
        resolve();
      });
    });
  }

  /** Polls the plan until no solve is running (and, given `after`, until a version newer than it exists). */
  async waitForPlan(planId: string, after: number | null = null): Promise<PlanOut> {
    const until = Date.now() + POLL_FOR_MS;
    for (;;) {
      const data = await call<PlanOut>(() => this.api.GET("/v1/plans/{plan_id}", { params: { path: { plan_id: planId } } }));
      if (data.status === "failed") {
        const e = (data.error ?? {}) as Partial<ErrorBody>;
        throw new ApiFailure(500, e.error ?? "solve_failed", e.message ?? "The solve failed.", e.detail);
      }
      const newer = after === null || (data.latest?.version ?? 0) > after;
      if (data.status === "ready" && newer) return data;
      if (Date.now() > until) throw new ApiFailure(504, "solve_timeout", "The solve is taking too long. Try again later.");
      await this.sleep(POLL_EVERY_MS);
    }
  }

  create(request: NewRouteRequest): Promise<PlanVersion> {
    // The API fills the defaulted fields; the body type wants them because responses always carry them.
    return this.solveCall(null, () => this.api.POST("/v1/plans", { body: { request: request as RouteRequest, source: "form" } }), null);
  }

  patch(planId: string, ops: PatchOp[], fromVersion: number, opened = false): Promise<PlanVersion> {
    return this.solveCall(planId, (v) => this.api.PATCH("/v1/plans/{plan_id}", {
      params: {
        path: { plan_id: planId },
        query: opened ? { from_version: fromVersion } : undefined,
        header: opened || v === null ? undefined : { "if-match": `"v${v}"` },
      },
      body: ops,
    }), opened ? null : fromVersion);
  }
}
