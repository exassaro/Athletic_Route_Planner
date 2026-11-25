/** usePlan keeps the plan on screen through every failure, and a Cancel is not an error (Step 9 amendment 7). */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Reply = () => Response;
const replies: Reply[] = [];
const version = (n: number, d = 10000) => ({ plan_id: "p1", version: n, outcome: "ok", candidates: [],
  request: { route_type: "loop", start: { lon: 75.8, lat: 11.2 }, target_distance_m: d } });
const err = (status: number, error: string, headers: Record<string, string> = {}) => () =>
  Response.json({ error, message: error, detail: null }, { status, headers });

beforeAll(() => {
  localStorage.setItem("athlete.token", "t");
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL) => {
    void input;
    const next = replies.shift();
    if (!next) throw new Error("unexpected request");
    return next();
  }) as typeof fetch);
});
afterAll(() => vi.unstubAllGlobals());

vi.stubEnv("NEXT_PUBLIC_API_BASE", "http://api.test");   // before the import: API_BASE is read once
const { usePlan } = await import("./usePlan");

describe("usePlan under load", () => {
  it("a 503 on an edit keeps the version on screen and says why", async () => {
    replies.push(() => Response.json(version(1), { status: 201 }));
    const { result } = renderHook(() => usePlan());
    await act(() => result.current.create(version(1).request as never));
    expect(result.current.version?.version).toBe(1);

    replies.push(err(503, "engine_unavailable"));
    act(() => result.current.edit({ kind: "distance", meters: 12000 }));
    await waitFor(() => expect(result.current.busy.kind).toBe("error"));
    expect(result.current.busy).toMatchObject({ error: { status: 503, message: expect.stringContaining("temporarily unavailable") } });
    expect(result.current.version?.version).toBe(1);
    expect(result.current.version?.request.target_distance_m).toBe(10000);
  });

  it("Cancel during a busy wait goes back to idle, with the plan as it was", async () => {
    replies.push(() => Response.json(version(1), { status: 201 }));
    const { result } = renderHook(() => usePlan());
    await act(() => result.current.create(version(1).request as never));

    replies.push(err(429, "solver_busy", { "Retry-After": "30" }));
    act(() => result.current.edit({ kind: "distance", meters: 12000 }));
    await waitFor(() => expect(result.current.busy.kind).toBe("busy"));
    act(() => result.current.cancelWaiting());
    await waitFor(() => expect(result.current.busy.kind).toBe("idle"));
    expect(result.current.version?.version).toBe(1);
    expect(replies).toHaveLength(0);                            // nothing more was sent
  });
});
