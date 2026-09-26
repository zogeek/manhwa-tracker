import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testClient } from 'hono/testing';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../app.js';
import { createContainer, type IntegrationOptions } from '../container.js';
import { ADMIN_ROLE } from '../shared/auth/index.js';
import { createDatabase } from '../shared/db/index.js';
import type { HttpFetch } from '../shared/http/outbound.js';
import { user } from '../shared/db/schema.js';
import { offlineFetch, TEST_INTEGRATIONS } from './fake-fetch.js';

export const TEST_ORIGIN = 'http://localhost:3000';
export const TEST_SCRAPER_API_KEY = 'integration-tests-scraper-key-0123456789abcdef';

export type TestContextOptions = {
  /** Faux client HTTP sortant (AniList, MangaDex, CDN d'images) ; hors-ligne par défaut. */
  fetch?: HttpFetch;
  discoveryProviders?: IntegrationOptions['discoveryProviders'];
};

const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

// Les quotas de prod (5 requêtes MangaDex en rafale) seraient épuisés par une suite de tests rapide.
const unlimited = { capacity: 10_000, refillPerMinute: 1_000_000 };

/**
 * App complète (vraie DB de test, vrai Better Auth) + client RPC typé.
 * Le worker de tâches n'est jamais démarré : les tests l'actionnent avec `worker.runOnce()`.
 */
export function createTestContext({
  fetch = offlineFetch,
  discoveryProviders = TEST_INTEGRATIONS.discoveryProviders,
}: TestContextOptions = {}) {
  const database = createDatabase(inject('databaseUrl'));
  const mediaStorageDir = mkdtempSync(join(tmpdir(), 'manhwa-media-'));
  const container = createContainer({
    db: database.db,
    auth: {
      secret: 'integration-tests-secret-0123456789abcdef',
      baseURL: TEST_ORIGIN,
      trustedOrigins: [TEST_ORIGIN],
      rateLimit: false,
    },
    integrations: {
      ...TEST_INTEGRATIONS,
      discoveryProviders,
      fetch,
      mediaStorageDir,
      rateLimits: { anilist: unlimited, mangadex: unlimited },
    },
    jobs: { workerId: 'integration-tests', batchSize: 50, logger: silentLogger },
  });
  const app = createApp({
    services: container.services,
    auth: container.auth,
    corsOrigins: [TEST_ORIGIN],
    scraperApiKey: TEST_SCRAPER_API_KEY,
    logRequests: false,
  });

  return {
    app,
    client: testClient(app),
    db: database.db,
    worker: container.worker,
    close: async () => {
      rmSync(mediaStorageDir, { recursive: true, force: true });
      await database.close();
    },
  };
}

export type TestContext = ReturnType<typeof createTestContext>;

export type TestUser = {
  id: string;
  /** En-têtes à passer au client pour agir en tant que cet utilisateur. */
  headers: { cookie: string };
};

const signUpResponseSchema = z.object({ user: z.object({ id: z.string() }) });

/** Inscrit un utilisateur via Better Auth et récupère son cookie de session signé. */
export async function signUp(context: TestContext, name: string): Promise<TestUser> {
  const res = await context.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: TEST_ORIGIN },
    body: JSON.stringify({
      name,
      email: `${name}-${randomUUID()}@test.local`,
      password: 'correct-horse-battery-staple',
    }),
  });
  if (res.status !== 200) {
    throw new Error(`Sign-up failed (${res.status}): ${await res.text()}`);
  }

  const cookie = res.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(';')[0])
    .join('; ');
  const { user } = signUpResponseSchema.parse(await res.json());
  return { id: user.id, headers: { cookie } };
}

/** Inscrit un utilisateur puis le promeut admin (équivalent de `pnpm admin:promote`). */
export async function signUpAdmin(context: TestContext, name: string): Promise<TestUser> {
  const admin = await signUp(context, name);
  await context.db.update(user).set({ role: ADMIN_ROLE }).where(eq(user.id, admin.id));
  return admin;
}
