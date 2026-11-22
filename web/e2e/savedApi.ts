/** Saved routes made through the API, for the Phase 5c specs: faster than planning each one on screen. */
import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { Schemas } from "../src/api/client";
import { TOKEN_KEY } from "../src/plan/planClient";

export const API = process.env.E2E_API ?? "http://localhost:8000";
const A01 = JSON.parse(readFileSync(new URL("../../api/athlete_api/examples/request_A01.json", import.meta.url), "utf8")).value;

export type Made = { token: string; headers: Record<string, string>; v1: Schemas["PlanVersionOut"]; saved: Schemas["SavedOut"] };

/** A client with A01 planned and one of its candidates saved. */
export async function savedA01(request: APIRequestContext, name: string | null = "Coast run", candidate = 0): Promise<Made> {
  const token = (await (await request.post(`${API}/v1/session`)).json()).token as string;
  const headers = { "X-Client-Token": token };
  const planned = await request.post(`${API}/v1/plans`, { headers, data: A01, timeout: 60_000 });
  expect(planned.ok(), await planned.text()).toBe(true);
  const v1 = await planned.json();
  const saved = await request.post(`${API}/v1/routes/${v1.candidates[candidate].route_id}/save`, { headers, data: { name } });
  expect(saved.ok(), await saved.text()).toBe(true);
  return { token, headers, v1, saved: await saved.json() };
}

/** The page acts as that client from its next load on. */
export async function actAs(page: Page, token: string) {
  await page.addInitScript(([key, value]) => localStorage.setItem(key!, value!), [TOKEN_KEY, token]);
}
