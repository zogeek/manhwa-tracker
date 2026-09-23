import { createMiddleware } from 'hono/factory';
import { ADMIN_ROLE, hasRole, type Auth, type AuthSession, type AuthUser } from '../auth/index.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

/** Variables garanties dans les handlers placés derrière `requireAuth`. */
export type AuthenticatedEnv = {
  Variables: {
    user: AuthUser;
    session: AuthSession['session'];
  };
};

/** Variables disponibles derrière `optionalAuth` (personnalisation d'une réponse publique uniquement). */
export type OptionalAuthEnv = {
  Variables: {
    user: AuthUser | null;
    session: AuthSession['session'] | null;
  };
};

/**
 * Middlewares d'authentification officiels (cf. CLAUDE.md) : l'identité provient EXCLUSIVEMENT
 * de la session Better Auth (cookie signé vérifié côté serveur), jamais d'un header client.
 */
export function createAuthMiddleware(auth: Auth) {
  const requireAuth = createMiddleware<AuthenticatedEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new UnauthorizedError();

    c.set('user', result.user);
    c.set('session', result.session);
    await next();
  });

  /** Session obligatoire (401) ET rôle admin (403). Réservé aux mutations du catalogue. */
  const requireAdmin = createMiddleware<AuthenticatedEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw new UnauthorizedError();
    if (!hasRole(result.user, ADMIN_ROLE)) throw new ForbiddenError('Admin role required');

    c.set('user', result.user);
    c.set('session', result.session);
    await next();
  });

  const optionalAuth = createMiddleware<OptionalAuthEnv>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });

    c.set('user', result?.user ?? null);
    c.set('session', result?.session ?? null);
    await next();
  });

  return { requireAuth, requireAdmin, optionalAuth };
}

export type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;
