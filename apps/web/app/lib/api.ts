import { hc } from "hono/client";
import type { AppType } from "api/app";

// Navigateur : on passe par le proxy Next.js (`/api/*`, même origine, cookies envoyés automatiquement).
// Serveur (RSC, route handlers) : appel direct au backend Hono.
const baseUrl =
  typeof window === "undefined" ? process.env.API_INTERNAL_URL ?? "http://localhost:3001" : "/api";

export const api = hc<AppType>(baseUrl);
