import type { NextConfig } from "next";

// URL du backend Hono vue par le serveur Next.js (jamais exposée au navigateur).
const apiUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:3001").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Proxy same-origin : le navigateur ne parle qu'à Next.js (même origine), qui relaie vers Hono.
  // → cookies de session Better Auth first-party, aucune requête cross-origin, donc pas de CORS.
  async rewrites() {
    return [
      // Better Auth est monté sur /api/auth/* côté Hono : le chemin est conservé tel quel.
      { source: "/api/auth/:path*", destination: `${apiUrl}/api/auth/:path*` },
      // Routes métier : Hono les expose à la racine (/manhwas, /reading…), on retire le préfixe /api.
      { source: "/api/:path*", destination: `${apiUrl}/:path*` },
    ];
  },
};

export default nextConfig;
