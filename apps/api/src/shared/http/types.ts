import type { RequestIdVariables } from 'hono/request-id';

/** Environnement Hono partagé par toute l'application. */
export type AppEnv = {
  Variables: RequestIdVariables & {
    /** Renseigné par le middleware d'auth (Better Auth, à venir). */
    userId?: string;
  };
};

/** Format de réponse unique pour les succès. `meta` accueillera la pagination. */
export type ApiSuccessBody<T> = { data: T };
