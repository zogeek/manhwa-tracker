// Routes des pages de l'application : un seul endroit à modifier pour renommer une URL.
// (Constantes partagées serveur ET client : ne pas les déplacer dans un module "use client".)

export const ROUTES = {
  home: "/",
  login: "/login",
  catalog: "/catalog",
  library: "/library",
  settings: "/settings",
  manhwa: (id: string) => `/manhwas/${id}`,
} as const;

/** Anciennes URLs françaises → nouvelles (redirections permanentes, cf. next.config.ts). */
export const LEGACY_ROUTES: readonly { from: string; to: string }[] = [
  { from: "/catalogue", to: ROUTES.catalog },
  { from: "/bibliotheque", to: ROUTES.library },
  { from: "/parametres", to: ROUTES.settings },
];
