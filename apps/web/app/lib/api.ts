import { hc } from "hono/client";
import type { AppType } from "api/app";
import { getApiInternalUrl } from "./env";

// Navigateur : on passe par le proxy Next.js (`/api/*`, même origine) → le cookie de session
// Better Auth part avec chaque requête. `credentials` est explicite pour ne jamais dépendre d'un défaut.
// Serveur (RSC, route handlers) : appel direct au backend Hono ; le cookie de l'utilisateur
// n'y est PAS ajouté automatiquement, il faut le relayer via `getForwardedAuthHeaders()` (dal.ts).
const isBrowser = typeof window !== "undefined";

export const api = hc<AppType>(isBrowser ? "/api" : getApiInternalUrl(), {
  init: { credentials: "same-origin" },
});
