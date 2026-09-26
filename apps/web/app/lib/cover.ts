/**
 * URL d'affichage d'une couverture : les images tierces passent par le proxy d'images de l'API
 * (`/api/images/proxy`, liste blanche anti-SSRF, cache 24 h) — le navigateur ne contacte jamais
 * directement les CDN des fournisseurs (anti-hotlinking, vie privée des lecteurs).
 * Utilisable côté serveur comme côté client.
 */
export function coverSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url; // déjà servie par nous
  const parsed = URL.parse(url);
  // Le proxy n'accepte que le HTTPS : inutile de produire une image cassée.
  if (parsed?.protocol !== "https:") return null;
  return `/api/images/proxy?${new URLSearchParams({ url: parsed.href })}`;
}
