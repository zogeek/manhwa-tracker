import type { NextConfig } from "next";
import { PUBLIC_API_RESOURCES } from "./app/lib/api-routes";
import { getApiInternalUrl } from "./app/lib/env";
import { LEGACY_ROUTES } from "./app/lib/routes";

// URL du backend Hono vue par le serveur Next.js (jamais exposée au navigateur).
const apiUrl = getApiInternalUrl();

const nextConfig: NextConfig = {
  // Anciennes URLs françaises (favoris, liens partagés) : redirection permanente (308), requête conservée.
  async redirects() {
    return LEGACY_ROUTES.flatMap(({ from, to }) => [
      { source: from, destination: to, permanent: true },
      { source: `${from}/:path*`, destination: `${to}/:path*`, permanent: true },
    ]);
  },
  // Proxy same-origin : le navigateur ne parle qu'à Next.js (même origine), qui relaie vers Hono.
  // → cookies de session Better Auth first-party, aucune requête cross-origin, donc pas de CORS.
  async rewrites() {
    return [
      // Better Auth est monté sur /api/auth/* côté Hono : le chemin est conservé tel quel.
      { source: "/api/auth/:path*", destination: `${apiUrl}/api/auth/:path*` },
      // Routes métier : uniquement les ressources publiques (liste blanche), préfixe /api retiré.
      // L'API machine /api/ingest/* (worker de scraping) n'est donc jamais joignable depuis le navigateur.
      {
        source: `/api/:resource(${PUBLIC_API_RESOURCES.join("|")})/:path*`,
        destination: `${apiUrl}/:resource/:path*`,
      },
    ];
  },
};

export default nextConfig;
