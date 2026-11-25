/** /link#<code> (Step 9): fragment cleared first, claim once, the warning, and every failure. No network. */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanClient, PREVIOUS_TOKEN_KEY, TOKEN_KEY } from "@/plan/planClient";

const CODE = "Ab-_0123456789abcdefghijklmnopqrst";
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

let store: Map<string, string>;
let calls: { path: string; token: string | null }[];
let answers: Record<string, () => Response>;
let shared: PlanClient;
vi.mock("@/plan/usePlan", () => ({ planClient: () => shared }));

const { LinkClaim } = await import("./LinkClaim");

const claimed = () => Response.json({ client_id: "c1", token: "new-token", header: "X-Client-Token" }, { status: 201 });

beforeEach(() => {
  store = new Map();
  calls = [];
  answers = { "/v1/session/claim": claimed, "/v1/me/routes": () => Response.json([]) };
  shared = new PlanClient({
    baseUrl: "http://api.test",
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    fetch: (async (input: RequestInfo | URL) => {
      const r = input as Request;
      const path = new URL(r.url).pathname;
      calls.push({ path, token: r.headers.get("X-Client-Token") });
      const a = answers[path];
      if (!a) throw new Error(`unexpected ${path}`);
      return a();
    }) as typeof globalThis.fetch,
  });
  replace.mockReset();
  window.history.replaceState(null, "", `/link#${CODE}`);
  sessionStorage.clear();
});
afterEach(cleanup);

const state = () => screen.getByTestId("link-page").dataset.state;

describe("LinkClaim", () => {
  it("clears the fragment, claims once without a token, stores it and goes to /routes", async () => {
    render(<LinkClaim />);
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/link");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/routes"));
    expect(calls).toEqual([{ path: "/v1/session/claim", token: null }]);
    expect(store.get(TOKEN_KEY)).toBe("new-token");
    expect(sessionStorage.getItem("gatho:linked")).not.toBeNull();
  });

  it("claims once under strict mode's double effect", async () => {
    const { StrictMode } = await import("react");
    render(<StrictMode><LinkClaim /></StrictMode>);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(calls.filter((c) => c.path === "/v1/session/claim")).toHaveLength(1);
  });

  it("warns a browser with saved routes of its own, and Cancel claims nothing", async () => {
    store.set(TOKEN_KEY, "old-token");
    answers["/v1/me/routes"] = () => Response.json([{ saved_id: "s1" }, { saved_id: "s2" }]);
    render(<LinkClaim />);
    expect((await screen.findByTestId("link-confirm")).textContent).toContain("2 saved routes");
    expect(screen.getByTestId("link-cancel").getAttribute("href")).toBe("/routes");
    expect(calls.map((c) => c.path)).toEqual(["/v1/me/routes"]);
    expect(store.get(TOKEN_KEY)).toBe("old-token");
  });

  it("'Link anyway' claims and keeps the old token aside", async () => {
    store.set(TOKEN_KEY, "old-token");
    answers["/v1/me/routes"] = () => Response.json([{ saved_id: "s1" }]);
    render(<LinkClaim />);
    fireEvent.click(await screen.findByTestId("link-anyway"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/routes"));
    expect(store.get(TOKEN_KEY)).toBe("new-token");
    expect(store.get(PREVIOUS_TOKEN_KEY)).toBe("old-token");
  });

  it("a browser whose own list is empty is not warned", async () => {
    store.set(TOKEN_KEY, "old-token");
    render(<LinkClaim />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/routes"));
    expect(screen.queryByTestId("link-confirm")).toBeNull();
  });

  it("an expired or used code says to ask for a new one", async () => {
    answers["/v1/session/claim"] = () => Response.json({ error: "link_invalid", message: "x", detail: null }, { status: 404 });
    render(<LinkClaim />);
    expect((await screen.findByTestId("link-invalid")).textContent).toContain("New code");
    expect(store.has(TOKEN_KEY)).toBe(false);
  });

  it("offline: says so, and 'Try again' uses the code it kept", async () => {
    answers["/v1/session/claim"] = () => { throw new TypeError("Failed to fetch"); };
    render(<LinkClaim />);
    await screen.findByTestId("link-failed");
    expect(state()).toBe("offline");
    answers["/v1/session/claim"] = claimed;
    await act(async () => void fireEvent.click(screen.getByTestId("link-retry")));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/routes"));
  });

  it("another failure shows the API's own reason", async () => {
    answers["/v1/session/claim"] = () => Response.json({ error: "rate_limited", message: "Too many claim requests.", detail: null }, { status: 429 });
    render(<LinkClaim />);
    expect((await screen.findByTestId("link-failed")).textContent).toContain("Too many claim requests.");
  });

  it("no code in the link: explains where to get one and sends nothing", async () => {
    window.history.replaceState(null, "", "/link");
    render(<LinkClaim />);
    await screen.findByTestId("link-no-code");
    expect(calls).toEqual([]);
  });
});
