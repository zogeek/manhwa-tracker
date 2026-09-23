import { randomUUID } from 'node:crypto';
import { testClient } from 'hono/testing';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { createApp } from '../app.js';
import { createContainer } from '../container.js';
import { ADMIN_ROLE } from '../shared/auth/index.js';
import { createDatabase } from '../shared/db/index.js';
import { user } from '../shared/db/schema.js';

export const TEST_ORIGIN = 'http://localhost:3000';

/** App complète (vraie DB de test, vrai Better Auth) + client RPC typé. */
export function createTestContext() {
  const database = createDatabase(inject('databaseUrl'));
  const container = createContainer({
    db: database.db,
    auth: {
      secret: 'integration-tests-secret-0123456789abcdef',
      baseURL: TEST_ORIGIN,
      trustedOrigins: [TEST_ORIGIN],
      rateLimit: false,
    },
  });
  const app = createApp({
    services: container.services,
    auth: container.auth,
    corsOrigins: [TEST_ORIGIN],
    logRequests: false,
  });

  return { app, client: testClient(app), db: database.db, close: database.close };
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
