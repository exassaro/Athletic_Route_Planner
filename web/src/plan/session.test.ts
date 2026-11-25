/** One session per browser (Step 9 amendment 6): lazily, once, across tabs, and again only after a failure. */
import { StrictMode, useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PlanClient, TOKEN_KEY, type Locks } from "./planClient";

function sharedStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k), m };
}

/** A Web Locks stand-in: callbacks for one name run one at a time, in order. */
function fakeLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request<T>(name: string, cb: () => Promise<T>): Promise<T> {
      const run = (tails.get(name) ?? Promise.resolve()).then(cb, cb);
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

/** A session endpoint that answers slowly (so callers overlap) and counts what it made. */
function sessionApi(fail = 0) {
  let made = 0;
  let failures = fail;
  const fetch = (async (input: RequestInfo | URL) => {
    const path = new URL((input as Request).url).pathname;
    if (path === "/v1/session") {
      await new Promise((r) => setTimeout(r, 20));
      if (failures > 0) {
        failures--;
        throw new TypeError("Failed to fetch");
      }
      made++;
      return Response.json({ client_id: "c", token: `tok-${made}`, header: "X-Client-Token" }, { status: 201 });
    }
    return Response.json([]);
  }) as typeof globalThis.fetch;
  return { fetch, made: () => made };
}

describe("session", () => {
  it("is not made until a request needs a token", async () => {
    const api = sessionApi();
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage: sharedStorage(), locks: null });
    expect(c.hasToken()).toBe(false);
    await c.api.GET("/v1/health");
    expect(api.made()).toBe(0);
    await c.api.GET("/v1/me/routes");
    expect(api.made()).toBe(1);
  });

  it("calls at the same time in one page share one session", async () => {
    const api = sessionApi();
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage: sharedStorage(), locks: null });
    const tokens = await Promise.all([c.token(), c.token(), c.api.GET("/v1/me/routes").then(() => c.token())]);
    expect(new Set(tokens)).toEqual(new Set(["tok-1"]));
    expect(api.made()).toBe(1);
  });

  it("two tabs opening together make one session (Web Lock, then storage read again)", async () => {
    const api = sessionApi();
    const storage = sharedStorage();          // localStorage is shared by the tabs of one origin
    const locks = fakeLocks();
    const tabA = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage, locks });
    const tabB = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage, locks });
    const [a, b] = await Promise.all([tabA.token(), tabB.token()]);
    expect([a, b]).toEqual(["tok-1", "tok-1"]);
    expect(api.made()).toBe(1);
    expect(storage.m.get(TOKEN_KEY)).toBe("tok-1");
  });

  it("without the lock the same two tabs would make two (what the lock prevents)", async () => {
    const api = sessionApi();
    const storage = sharedStorage();
    const tabA = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage, locks: null });
    const tabB = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage, locks: null });
    await Promise.all([tabA.token(), tabB.token()]);
    expect(api.made()).toBe(2);
  });

  it("a failed request stores nothing, and the next call makes exactly one", async () => {
    const api = sessionApi(1);
    const storage = sharedStorage();
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage, locks: fakeLocks() });
    await expect(c.token()).rejects.toMatchObject({ status: 0 });
    expect(storage.m.has(TOKEN_KEY)).toBe(false);
    expect(await Promise.all([c.token(), c.token()])).toEqual(["tok-1", "tok-1"]);
    expect(api.made()).toBe(1);
  });

  it("React strict mode's double effects make one session", async () => {
    const api = sessionApi();
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage: sharedStorage(), locks: null });
    function Asks() {
      useEffect(() => void c.api.GET("/v1/me/routes"), []);
      return null;
    }
    render(createElement(StrictMode, null, createElement(Asks), createElement(Asks)));
    await waitFor(() => expect(api.made()).toBe(1));
    await new Promise((r) => setTimeout(r, 60));
    expect(api.made()).toBe(1);
  });
});
