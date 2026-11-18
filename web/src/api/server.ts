/**
 * The API as the Next.js server reaches it (server-rendered pages). In development the same address as the
 * browser's; behind Caddy or in Docker, API_INTERNAL_BASE (e.g. http://api:8000).
 */
import createClient from "openapi-fetch";
import type { paths } from "./schema";

export const API_INTERNAL_BASE = process.env.API_INTERNAL_BASE || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export const serverApi = createClient<paths>({ baseUrl: API_INTERNAL_BASE });
