/** "Use on another device" (Step 9): the link, the fragment, the claim and the QR path. No network. */
import { describe, expect, it } from "vitest";
import { PlanClient, PREVIOUS_TOKEN_KEY, TOKEN_KEY } from "@/plan/planClient";
import { claimLinkCode, codeFromHash, linkUrl, mmss, requestLinkCode } from "./link";
import { takeLinked, markLinked } from "./linked";

const CODE = "Ab-_0123456789abcdefghijklmnopqrst";   // 32 URL-safe characters, as the API makes them

function storage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k), m };
}

function fakeApi(answer: (path: string) => Response) {
  const calls: { path: string; token: string | null; body: string }[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const r = input as Request;
    const path = new URL(r.url).pathname;
    calls.push({ path, token: r.headers.get("X-Client-Token"), body: await r.text() });
    return answer(path);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("link and fragment", () => {
  it("puts the code in the fragment, never the query", () => {
    const url = linkUrl("https://gatho.shahinsha.xyz/", CODE);
    expect(url).toBe(`https://gatho.shahinsha.xyz/link#${CODE}`);
    expect(new URL(url).search).toBe("");
    expect(new URL(url).hash).toBe(`#${CODE}`);
  });

  it("reads only URL-safe codes back", () => {
    expect(codeFromHash(`#${CODE}`)).toBe(CODE);
    expect(codeFromHash(CODE)).toBe(CODE);
    for (const bad of ["", "#", "#short", "#has space and more letters", "#%E0%A4%A", "#<script>alert(1)</script>"]) {
      expect(codeFromHash(bad)).toBeNull();
    }
  });

  it("counts down in minutes and seconds", () => {
    expect([mmss(300), mmss(299.2), mmss(59), mmss(0), mmss(-3)]).toEqual(["5:00", "5:00", "0:59", "0:00", "0:00"]);
  });

  it("the 'Linked' mark is shown once, and only soon after linking", () => {
    markLinked();
    expect(takeLinked()).toBe(true);
    expect(takeLinked()).toBe(false);
    markLinked();
    expect(takeLinked(Date.now() + 120_000)).toBe(false);
  });
});

describe("claim", () => {
  it("sends no token, then uses the new one and keeps the old one aside", async () => {
    const s = storage({ [TOKEN_KEY]: "old-token" });
    const api = fakeApi((path) => path === "/v1/session/claim"
      ? Response.json({ client_id: "c1", token: "new-token", header: "X-Client-Token" }, { status: 201 })
      : Response.json([]));
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage: s });
    await claimLinkCode(c, CODE);
    expect(api.calls[0]).toEqual({ path: "/v1/session/claim", token: null, body: JSON.stringify({ code: CODE }) });
    expect(s.m.get(TOKEN_KEY)).toBe("new-token");
    expect(s.m.get(PREVIOUS_TOKEN_KEY)).toBe("old-token");
    await c.api.GET("/v1/me/routes");
    expect(api.calls.at(-1)!.token).toBe("new-token");
  });

  it("a browser with no token gets one without making a session", async () => {
    const s = storage();
    const api = fakeApi(() => Response.json({ client_id: "c1", token: "new-token", header: "X-Client-Token" }, { status: 201 }));
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage: s });
    expect(c.hasToken()).toBe(false);
    await claimLinkCode(c, CODE);
    expect(api.calls.map((x) => x.path)).toEqual(["/v1/session/claim"]);
    expect(s.m.get(PREVIOUS_TOKEN_KEY)).toBeUndefined();
    expect(c.hasToken()).toBe(true);
  });

  it("an invalid code is the API's 404, and nothing is stored", async () => {
    const s = storage({ [TOKEN_KEY]: "old-token" });
    const api = fakeApi(() => Response.json({ error: "link_invalid", message: "Not valid.", detail: null }, { status: 404 }));
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage: s });
    await expect(claimLinkCode(c, CODE)).rejects.toMatchObject({ status: 404, code: "link_invalid" });
    expect(s.m.get(TOKEN_KEY)).toBe("old-token");
    expect(s.m.has(PREVIOUS_TOKEN_KEY)).toBe(false);
  });

  it("asking for a code sends this browser's token", async () => {
    const api = fakeApi(() => Response.json({ code: CODE, expires_in_s: 300 }, { status: 201 }));
    const c = new PlanClient({ baseUrl: "http://api.test", fetch: api.fetch, storage: storage({ [TOKEN_KEY]: "t" }) });
    expect(await requestLinkCode(c)).toEqual({ code: CODE, expires_in_s: 300 });
    expect(api.calls[0]).toMatchObject({ path: "/v1/session/link", token: "t" });
  });
});
