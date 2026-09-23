import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
import type { Database } from '../db/index.js';
import * as schema from '../db/schema.js';

export type AuthOptions = {
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  /** Désactivable uniquement pour les tests d'intégration (inscriptions en rafale). */
  rateLimit?: boolean;
};

/**
 * Source de vérité unique de la configuration Better Auth (cf. CLAUDE.md).
 * Instanciée une seule fois, par la composition root (`container.ts`).
 */
export function createAuth({ db, secret, baseURL, trustedOrigins, rateLimit = true }: AuthOptions) {
  return betterAuth({
    appName: 'Manhwa Tracker',
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
    },
    // Rôles (`user` par défaut, `admin`) + endpoints d'administration /api/auth/admin/* réservés aux admins.
    plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
    // Protection brute-force sur /api/auth/* (stockage mémoire : suffisant pour une instance unique).
    rateLimit: {
      enabled: rateLimit,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
export type AuthUser = AuthSession['user'];

export const ADMIN_ROLE = 'admin';

/** Le plugin admin stocke les rôles en liste séparée par des virgules (ex. "user,admin"). */
export function hasRole(user: Pick<AuthUser, 'role'>, role: string): boolean {
  return (user.role ?? '').split(',').some((value) => value.trim() === role);
}
