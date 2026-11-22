/** What a failed call says: the API's own reason, or that it was not the API that answered. */
import { describe, expect, it } from "vitest";
import { ApiFailure, apiFailure, apiSaid, call, PlanClient } from "./planClient";

const at = (href: string) => new URL(href);
const HTML = "<!DOCTYPE html><html><body>404</body></html>";

function answering(status: number, body: string, type = "text/html") {
  return new PlanClient({ baseUrl: "http://api.test",
    fetch: (async () => new Response(body, { status, headers: { "Content-Type": type } })) as typeof fetch });
}

describe("apiFailure", () => {
  it("keeps the API's own code, message and detail", () => {
    expect(apiFailure(429, { error: "rate_limited", message: "Too many.", detail: 7 }))
      .toMatchObject({ status: 429, code: "rate_limited", message: "Too many.", detail: 7 });
  });

  it.each(["http://localhost:3000/", "http://192.0.2.7:3000/routes", "http://192.0.2.7/"])(
    "on %s a same-origin build names the https address to open", (href) => {
      const f = apiFailure(404, HTML, "", at(href));
      expect(f.code).toBe("api_not_here");
      expect(f.message).toBe(`GATHO's API isn't at this address. Open https://${at(href).hostname} instead.`);
    });

  it("offers no other address from the https one, or from a build with its own API address", () => {
    expect(apiFailure(404, HTML, "", at("https://localhost/")).message).toBe("GATHO's API isn't at this address.");
    expect(apiFailure(405, "", "http://localhost:8000", at("http://localhost:3000/")).message)
      .toBe("GATHO's API isn't at this address.");
  });

  it.each([500, 502, 503])("%i without the API's body keeps its status", (status) => {
    expect(apiFailure(status, "").message).toBe(`GATHO's API didn't answer properly (${status}).`);
  });
});

describe("apiSaid", () => {
  it("is true only for the API's own answer", () => {
    expect(apiSaid(apiFailure(404, { error: "not_found", message: "No." }), 404)).toBe(true);
    expect(apiSaid(apiFailure(404, HTML), 404)).toBe(false);
    expect(apiSaid(apiFailure(503, ""), 503)).toBe(false);
    expect(apiSaid(new ApiFailure(404, "not_found", "No such saved route."), 404)).toBe(true);
  });
});

describe("the session", () => {
  it.each([[404, HTML], [405, ""], [500, "Internal Server Error"], [502, ""]])(
    "a %i is reported as itself, never as 429", async (status, body) => {
      await expect(answering(status, body).token()).rejects.toMatchObject({ status });
    });

  it("a real limit keeps the API's message", async () => {
    const c = answering(429, JSON.stringify({ error: "rate_limited", message: "Too many session requests." }), "application/json");
    await expect(c.token()).rejects.toMatchObject({ status: 429, message: "Too many session requests." });
  });

  it("a call that needed a session rejects with the session's reason", async () => {
    const c = answering(404, HTML);
    await expect(call(() => c.api.GET("/v1/me/routes"))).rejects.toMatchObject({ code: "api_not_here" });
  });

  it("no network is status 0, when planning too", async () => {
    const c = new PlanClient({ baseUrl: "http://api.test",
      fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    await expect(c.create({ route_type: "loop", start: { lon: 1, lat: 1 }, target_distance_m: 5000, direction: null } as never))
      .rejects.toMatchObject({ status: 0, code: "network", message: "No answer from GATHO. Check your connection." });
  });
});
