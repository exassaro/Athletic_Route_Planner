/** The waiting rules of PlanClient against a scripted fake API (no network). */
import { describe, expect, it } from "vitest";
import { ApiFailure, PlanClient, TOKEN_KEY, type Status } from "./planClient";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function fakeApi(replies: Record<string, Reply[]>) {
  const calls: { method: string; path: string; headers: Headers; body: string | null }[] = [];
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const req = input as Request;
    const path = new URL(req.url).pathname;
    calls.push({ method: req.method, path, headers: req.headers, body: req.body ? await req.text() : null });
    const key = `${req.method} ${path}`;
    const queue = replies[key];
    const reply = queue && queue.length > 1 ? queue.shift()! : queue?.[0];
    if (!reply) throw new Error(`unexpected ${key}`);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body),
      { status: reply.status, headers: { "Content-Type": "application/json", ...reply.headers } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const version = (n: number) => ({ plan_id: "p1", version: n, outcome: "ok" });
const session = { status: 201, body: { client_id: "c", token: "tok-1", header: "X-Client-Token" } };
const err = (status: number, error: string, detail?: unknown, headers?: Record<string, string>): Reply =>
  ({ status, body: { error, message: error, detail }, headers });

function client(replies: Record<string, Reply[]>) {
  const api = fakeApi({ "POST /v1/session": [session], ...replies });
  const statuses: Status[] = [];
  const slept: number[] = [];
  const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, sleep: async (ms) => void slept.push(ms),
    onStatus: (s) => statuses.push(s) });
  return { c, api, statuses, slept };
}

describe("PlanClient", () => {
  it("an edit of an opened older version names it, without If-Match", async () => {
    const queries: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      const r = input as Request;
      if (new URL(r.url).pathname === "/v1/session") return Response.json({ token: "t" }, { status: 201 });
      queries.push(`${new URL(r.url).search} ${r.headers.get("if-match")}`);
      return Response.json(version(8));
    }) as typeof globalThis.fetch;
    const c = new PlanClient({ baseUrl: "http://api.test", fetch });
    await c.patch("p1", [], 5, true);
    await c.patch("p1", [], 8);
    expect(queries).toEqual(["?from_version=5 null", ' "v8"']);
  });

  it("gets a token once and sends it", async () => {
    const { c, api } = client({ "POST /v1/plans": [{ status: 201, body: version(1) }] });
    await c.create({ route_type: "loop", start: { lon: 75.8, lat: 11.2 }, target_distance_m: 10000 });
    await c.create({ route_type: "loop", start: { lon: 75.8, lat: 11.2 }, target_distance_m: 10000 });
    expect(api.calls.filter((x) => x.path === "/v1/session")).toHaveLength(1);
    expect(api.calls.at(-1)!.headers.get("X-Client-Token")).toBe("tok-1");
  });

  it("solver_busy: waits Retry-After and tries again", async () => {
    const { c, statuses, slept } = client({ "POST /v1/plans": [err(429, "solver_busy", null, { "Retry-After": "5" }),
      { status: 201, body: version(1) }] });
    const v = await c.create({ route_type: "loop", start: { lon: 75.8, lat: 11.2 }, target_distance_m: 10000 });
    expect(v.version).toBe(1);
    expect(slept).toEqual([5000]);
    expect(statuses).toContainEqual({ kind: "busy", reason: "solver_busy", retryInS: 5, attempt: 1 });
  });

  it("gives up after MAX_TRIES busy answers", async () => {
    const { c } = client({ "POST /v1/plans": [err(429, "solver_busy", null, { "Retry-After": "1" })] });
    await expect(c.create({ route_type: "loop", start: { lon: 75.8, lat: 11.2 }, target_distance_m: 10000 }))
      .rejects.toMatchObject({ status: 429, code: "solver_busy" });
  });

  it("plan_solving: polls until ready, then sends on top of the new version with If-Match", async () => {
    const { c, api, slept } = client({
      "PATCH /v1/plans/p1": [err(409, "plan_solving"), { status: 200, body: version(4) }],
      "GET /v1/plans/p1": [{ status: 200, body: { plan_id: "p1", status: "solving", versions: [1, 2], latest: version(2) } },
        { status: 200, body: { plan_id: "p1", status: "ready", versions: [1, 2, 3], latest: version(3) } }],
    });
    const v = await c.patch("p1", [{ op: "replace", path: "/target_distance_m", value: 20000 }], 2);
    expect(v.version).toBe(4);
    const patches = api.calls.filter((x) => x.method === "PATCH");
    expect(patches.map((x) => x.headers.get("If-Match"))).toEqual(['"v2"', '"v3"']);
    expect(JSON.parse(patches[0]!.body!)).toEqual([{ op: "replace", path: "/target_distance_m", value: 20000 }]);
    expect(slept).toEqual([1500]);
  });

  it("solve_timeout: polls the plan until the new version appears", async () => {
    const { c, statuses } = client({
      "PATCH /v1/plans/p1": [err(504, "solve_timeout", { plan_id: "p1", poll: "/v1/plans/p1" })],
      "GET /v1/plans/p1": [{ status: 200, body: { plan_id: "p1", status: "solving", versions: [1], latest: version(1) } },
        { status: 200, body: { plan_id: "p1", status: "ready", versions: [1, 2], latest: version(2) } }],
    });
    expect((await c.patch("p1", [], 1)).version).toBe(2);
    expect(statuses).toContainEqual({ kind: "waiting", reason: "solve_timeout" });
  });

  it("a failed solve while polling is an error with the API's code", async () => {
    const { c } = client({
      "PATCH /v1/plans/p1": [err(504, "solve_timeout", { plan_id: "p1" })],
      "GET /v1/plans/p1": [{ status: 200, body: { plan_id: "p1", status: "failed", versions: [1], latest: version(1),
        error: { error: "engine_unavailable", message: "Valhalla stopped", detail: null } } }],
    });
    await expect(c.patch("p1", [], 1)).rejects.toMatchObject({ code: "engine_unavailable" });
  });

  it("401: renews the token once", async () => {
    const api = fakeApi({
      "POST /v1/session": [{ status: 201, body: { client_id: "c", token: "tok-2", header: "X-Client-Token" } }],
      "POST /v1/plans": [err(401, "client_required"), { status: 201, body: version(1) }],
    });
    const store = new Map([[TOKEN_KEY, "stale"]]);
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, sleep: async () => {},
      storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } });
    await c.create({ route_type: "loop", start: { lon: 75.8, lat: 11.2 }, target_distance_m: 10000 });
    expect(api.calls.filter((x) => x.path === "/v1/plans").map((x) => x.headers.get("X-Client-Token"))).toEqual(["stale", "tok-2"]);
  });

  it("other errors carry the API's code, message and detail", async () => {
    const { c } = client({ "PATCH /v1/plans/p1": [err(422, "invalid_request", [{ loc: ["body"], msg: "bad" }])] });
    const e = await c.patch("p1", [], 1).catch((x) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect(e).toMatchObject({ status: 422, code: "invalid_request", detail: [{ loc: ["body"], msg: "bad" }] });
  });
});
