/**
 * The typed API client (blueprint Phase 5 amendment 2). Types come only from schema.d.ts, which
 * openapi-typescript generates from openapi.json (exported from the API by api/scripts/export_openapi.py).
 * Never hand-copy RouteRequest, SolveResult or any other API model.
 */
import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export const api = createClient<paths>({ baseUrl: API_BASE });

export type Schemas = components["schemas"];
export type RouteRequest = Schemas["RouteRequest"];
export type PlanVersion = Schemas["PlanVersionOut"];
export type Candidate = Schemas["CandidateOut"];
export type PatchOp = Schemas["PatchOp"];

/**
 * Fields the API fills with a default when a request leaves them out. Responses always carry them (so the
 * generated types mark them required); a request the client builds from scratch may omit them. A test checks
 * this list against openapi.json, so it cannot drift from the API.
 */
export const REQUEST_DEFAULTED = ["activity", "alternatives", "checkpoint_order", "tolerance_m"] as const;
export type NewRouteRequest = Omit<RouteRequest, (typeof REQUEST_DEFAULTED)[number]> &
  Partial<Pick<RouteRequest, (typeof REQUEST_DEFAULTED)[number]>>;
