import type { RequestIdVariables } from 'hono/request-id';

/**
 * Environnement Hono partagé par toute l'application.
 * L'utilisateur n'y figure pas : il n'existe que sur les routes protégées, via l'env de `requireAuth`.
 */
export type AppEnv = {
  Variables: RequestIdVariables;
};

/** Format de réponse unique pour les succès. `meta` accueillera la pagination. */
export type ApiSuccessBody<T> = { data: T };
