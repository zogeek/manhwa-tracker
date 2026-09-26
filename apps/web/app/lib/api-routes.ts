import type { hc } from "hono/client";
import type { AppType } from "api/app";

/** Espaces de routes racines du contrat RPC public (`/manhwas`, `/reading`…). */
type PublicApiResource = keyof ReturnType<typeof hc<AppType>>;

// Record exhaustif : TypeScript exige chaque ressource de AppType et refuse toute clé inconnue.
// Une route ajoutée (ou retirée) côté API casse donc le typecheck tant que cette liste n'est pas à jour.
const PROXIED_RESOURCES: Record<PublicApiResource, true> = {
  health: true,
  sources: true,
  manhwas: true,
  chapters: true,
  taxonomy: true,
  reading: true,
  images: true,
};

/**
 * Liste blanche des ressources relayées par le proxy Next.js (`/api/<ressource>/…` → Hono).
 * Modèle positif : tout ce qui n'est pas listé (notamment l'API machine `/api/ingest`,
 * y compris sous forme encodée comme `/api/%61pi/ingest`) n'est jamais relayé → 404.
 */
export const PUBLIC_API_RESOURCES = Object.keys(PROXIED_RESOURCES);
