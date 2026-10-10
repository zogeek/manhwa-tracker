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

const DEFAULT_DIST_DIR = ".next";

/**
 * Dossier de build de Next.js. Les tests E2E construisent dans un dossier à part (`.next-e2e`) :
 * leur build vise une API de test, et les rewrites sont figés au build — il ne doit jamais
 * remplacer le build de dev/prod. Chemin relatif simple uniquement (pas de `..`, pas d'absolu).
 */
export function getDistDir(value = process.env.NEXT_DIST_DIR): string {
  const dir = value?.trim() || DEFAULT_DIST_DIR;
  if (!/^\.?[A-Za-z0-9_-]+$/.test(dir)) {
    throw new Error(`NEXT_DIST_DIR invalide : « ${dir} » (attendu : un nom de dossier, ex. .next-e2e)`);
  }
  return dir;
}
