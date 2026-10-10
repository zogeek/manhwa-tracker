// Configuration serveur du front. Seul module à lire `process.env` : next.config.ts (proxy),
// le client RPC et le client Better Auth serveur partagent ainsi la même URL, normalisée.

const DEFAULT_API_INTERNAL_URL = "http://localhost:3001";

/**
 * URL interne du backend Hono (sans `/` final), vue par le serveur Next.js uniquement.
 * Le navigateur, lui, passe toujours par le proxy same-origin `/api/*`.
 * Une valeur mal formée fait échouer le démarrage avec un message clair, plutôt qu'un 500 opaque plus tard.
 */
export function getApiInternalUrl(value = process.env.API_INTERNAL_URL): string {
  const raw = value?.trim() || DEFAULT_API_INTERNAL_URL;
  if (!URL.canParse(raw) || !/^https?:$/.test(new URL(raw).protocol)) {
    throw new Error(`API_INTERNAL_URL invalide : « ${raw} » (attendu : http(s)://hôte:port)`);
  }
  return raw.replace(/\/+$/, "");
}
