/** The saved-route calls against a fake API (no network). */
import { describe, expect, it } from "vitest";
import { PlanClient, TOKEN_KEY } from "@/plan/planClient";
import { deleteSaved, listSaved, openSaved, saveRoute } from "./api";

function client(answer: (request: Request) => Response | Promise<Response>) {
  const storage = new Map([[TOKEN_KEY, "tok"]]);
  return new PlanClient({
    baseUrl: "http://api.test",
    fetch: (async (input: RequestInfo | URL) => answer(input as Request)) as typeof fetch,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v), removeItem: (k) => void storage.delete(k) },
  });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const row = { saved_id: "s1", plan_id: "p1", plan_version: 5, route_id: "r2" };
const v5 = { plan_id: "p1", version: 5, candidates: [{ route_id: "r1" }, { route_id: "r2" }], diff: { from_version: 4 } };

describe("openSaved", () => {
  it("loads the saved route's own version, as a fresh result with no diff", async () => {
    const paths: string[] = [];
    const c = client((r) => {
      const path = new URL(r.url).pathname;
      paths.push(path);
      return path === "/v1/me/routes" ? json([row]) : json(v5);
    });
    const { saved, version } = await openSaved(c, "s1");
    expect(paths).toEqual(["/v1/me/routes", "/v1/plans/p1/versions/5"]);
    expect(saved.route_id).toBe("r2");
    expect(version.diff).toBeNull();
  });

  it("404 when it isn't this client's, or its plan is gone", async () => {
    await expect(openSaved(client(() => json([])), "s1")).rejects.toMatchObject({ status: 404 });
    const gone = client((r) => (r.url.endsWith("/me/routes") ? json([row]) : json({ error: "not_found", message: "gone" }, 404)));
    await expect(openSaved(gone, "s1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("saved-route calls", () => {
  it("a 204 is a success", async () => {
    await expect(deleteSaved(client(() => new Response(null, { status: 204 })), "s1")).resolves.toBeUndefined();
  });

  it("offline is status 0 and a 5xx keeps its status", async () => {
    await expect(listSaved(client(() => Promise.reject(new TypeError("Failed to fetch"))))).rejects.toMatchObject({ status: 0 });
    await expect(deleteSaved(client(() => json({ error: "down", message: "down" }, 503)), "s1")).rejects.toMatchObject({ status: 503 });
  });

  it("as_new is sent only when asked for", async () => {
    const bodies: unknown[] = [];
    const c = client(async (r) => {
      bodies.push(await r.json());
      return json({ saved_id: "s1" }, 201);
    });
    await saveRoute(c, "r1", "A");
    await saveRoute(c, "r1", null, true);
    expect(bodies).toEqual([{ name: "A" }, { name: null, as_new: true }]);
  });
});
