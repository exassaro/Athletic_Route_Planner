/**
 * Talks to the API for the planner: the anonymous session, create and patch with the waiting rules, and reads.
 * Types are the generated ones only (Phase 5 amendment 2).
 *
 * Waiting rules (section 13 states, Phase 4 amendments 3, 12, 19):
 * - 429 solver_busy / rate_limited: wait Retry-After (capped), try again, at most MAX_TRIES times.
 * - 409 plan_solving: a solve for this plan is running; poll the plan until it is ready, then send again.
 * - 412 version_mismatch: someone (another tab) made a newer version; send again on top of it. The patch's
 *   `test` operations stop a stale removal.
 * - 504 solve_timeout: the solve carries on; poll the plan until the new version appears.
 * - 401: the token is unknown (database reset); get a new one and try once more.
 * Anything else is an ApiFailure with the API's own error code and message.
 */
import createClient from "openapi-fetch";
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
export const MAX_TRIES = 4;
const MAX_WAIT_S = 30;
const POLL_EVERY_MS = 1500;
const POLL_FOR_MS = 60_000;

export type Status =
  | { kind: "solving" }
  | { kind: "busy"; reason: "solver_busy" | "rate_limited"; retryInS: number; attempt: number }
  | { kind: "waiting"; reason: "plan_solving" | "solve_timeout" };

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: unknown) {
    super(message);
  }
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export type Options = {
  baseUrl: string;
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

export class PlanClient {
  readonly api;
  private storage: Storage;
  private sleep: (ms: number) => Promise<void>;
  private onStatus: (s: Status) => void;
  private tokenPromise: Promise<string> | null = null;

  constructor(private opts: Options) {
    this.storage = opts.storage ?? memoryStorage();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onStatus = opts.onStatus ?? (() => {});
    this.api = createClient<paths>({ baseUrl: opts.baseUrl, fetch: opts.fetch });
    this.api.use({
      onRequest: async ({ request, schemaPath }) => {
        if (schemaPath === "/v1/session" || schemaPath.startsWith("/v1/share") || schemaPath === "/v1/health") return;
        request.headers.set("X-Client-Token", await this.token());
        return request;
      },
    });
  }

  token(): Promise<string> {
    const saved = this.storage.getItem(TOKEN_KEY);
    if (saved) return Promise.resolve(saved);
    this.tokenPromise ??= (async () => {
      const { data, error } = await this.api.POST("/v1/session");
      if (!data) throw this.failure(429, error);
      this.storage.setItem(TOKEN_KEY, data.token);
      return data.token;
    })().finally(() => (this.tokenPromise = null));
    return this.tokenPromise;
  }

  private failure(status: number, body: unknown): ApiFailure {
    const b = (body ?? {}) as Partial<ErrorBody>;
    return new ApiFailure(status, b.error ?? `http_${status}`, b.message ?? `The API answered ${status}.`, b.detail);
  }

  /** Runs a create or patch with the waiting rules. `send(version)` gets the version to build on (If-Match). */
  private async solveCall(planId: string | null, send: (ifVersion: number | null) =>
    Promise<{ data?: unknown; error?: unknown; response: Response }>, ifVersion: number | null): Promise<PlanVersion> {
    let version = ifVersion;
    let renewed = false;
    for (let attempt = 1; ; attempt++) {
      this.onStatus({ kind: "solving" });
      const { data, error, response } = await send(version);
      if (data) return data as PlanVersion;
      const f = this.failure(response.status, error);
      if (response.status === 429 && attempt < MAX_TRIES && (f.code === "solver_busy" || f.code === "rate_limited")) {
        const after = Number(response.headers.get("Retry-After")) || 2 ** attempt;
        const wait = Math.min(after, MAX_WAIT_S);
        this.onStatus({ kind: "busy", reason: f.code, retryInS: wait, attempt });
        await this.sleep(wait * 1000);
        continue;
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
        if (!id) throw f;
        this.onStatus({ kind: "waiting", reason: "solve_timeout" });
        const plan = await this.waitForPlan(id, ifVersion);
        if (plan.latest) return plan.latest;
      }
      throw f;
    }
  }

  /** Polls the plan until no solve is running (and, given `after`, until a version newer than it exists). */
  async waitForPlan(planId: string, after: number | null = null): Promise<PlanOut> {
    const until = Date.now() + POLL_FOR_MS;
    for (;;) {
      const { data: raw, error, response } = await this.api.GET("/v1/plans/{plan_id}", { params: { path: { plan_id: planId } } });
      if (!raw) throw this.failure(response.status, error);
      const data = raw as PlanOut;
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

  patch(planId: string, ops: PatchOp[], fromVersion: number): Promise<PlanVersion> {
    return this.solveCall(planId, (v) => this.api.PATCH("/v1/plans/{plan_id}", {
      params: { path: { plan_id: planId }, header: v === null ? undefined : { "if-match": `"v${v}"` } },
      body: ops,
    }), fromVersion);
  }
}
