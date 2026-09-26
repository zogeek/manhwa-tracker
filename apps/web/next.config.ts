import type { NextConfig } from "next";
import { PUBLIC_API_RESOURCES } from "./app/lib/api-routes";

// URL du backend Hono vue par le serveur Next.js (jamais exposée au navigateur).
const apiUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:3001").replace(/\/+$/, "");

const nextConfig: NextConfig = {
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
