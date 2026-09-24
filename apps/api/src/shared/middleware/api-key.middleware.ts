import { createHash, timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { UnauthorizedError } from '../lib/errors.js';

export const API_KEY_HEADER = 'x-api-key';

/** Identité machine exposée aux handlers placés derrière `requireApiKey`. */
export type MachineEnv = {
  Variables: {
    machine: { name: 'scraper' };
  };
};

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/**
 * Authentification machine-à-machine (M2M), indépendante de Better Auth.
 * La clé attendue vient de la configuration (SCRAPER_API_KEY), jamais du code.
 * Comparaison en temps constant sur des empreintes de même longueur : la durée de la réponse
 * ne révèle ni la longueur ni le préfixe correct de la clé.
 */
export function createApiKeyMiddleware(expectedKey: string) {
  const expectedDigest = digest(expectedKey);

  const requireApiKey = createMiddleware<MachineEnv>(async (c, next) => {
    const provided = c.req.header(API_KEY_HEADER);
    if (!provided || !timingSafeEqual(digest(provided), expectedDigest)) {
      throw new UnauthorizedError('Invalid or missing API key');
    }
    c.set('machine', { name: 'scraper' });
    await next();
  });

  return { requireApiKey };
}

export type ApiKeyMiddleware = ReturnType<typeof createApiKeyMiddleware>;
