/**
 * URL d'affichage d'une couverture tierce : via le proxy d'images de l'API (`/api/images/proxy`,
 * liste blanche anti-SSRF, cache 24 h) — le navigateur ne contacte jamais directement les CDN
 * des fournisseurs (anti-hotlinking, vie privée des lecteurs). Utilisable serveur et client.
 */
export function coverSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url; // déjà servie par nous
  const parsed = URL.parse(url);
  // Le proxy n'accepte que le HTTPS : inutile de produire une image cassée.
  if (parsed?.protocol !== "https:") return null;
  return `/api/images/proxy?${new URLSearchParams({ url: parsed.href })}`;
}

/** Préfixe du proxy Next.js vers l'API (`/api/<ressource>/…` → Hono `/<ressource>/…`). */
const API_PROXY_PREFIX = "/api";

type CoverFields = { coverUrl: string | null; localCoverUrl?: string | null };

/**
 * Sources d'une couverture, par ordre de préférence :
 * 1. la copie locale (tâche `cover.mirror` réussie) : servie par notre API, cache « immutable » ;
 * 2. l'image d'origine via le proxy (copie pas encore faite, ou fichier local indisponible).
 * `CoverImage` passe à la suivante si une source échoue : jamais d'image cassée à l'écran.
 */
export function coverSources({ coverUrl, localCoverUrl }: CoverFields): string[] {
  const sources: string[] = [];
  // `localCoverUrl` est relatif à l'API (`/images/media/…`) : le navigateur y accède via le proxy Next.
  if (localCoverUrl?.startsWith("/images/")) sources.push(`${API_PROXY_PREFIX}${localCoverUrl}`);
  const remote = coverSrc(coverUrl);
  if (remote) sources.push(remote);
  return sources;
}
