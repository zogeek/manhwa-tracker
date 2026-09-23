import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app.js';
import { createContainer } from './container.js';
import { createDatabase } from './shared/db/index.js';

// Pool pg paresseux : aucune connexion n'est ouverte tant qu'aucune requête n'atteint la DB.
// Ces tests ne couvrent que les chemins qui s'arrêtent avant la couche données.
const database = createDatabase('postgres://unused:unused@127.0.0.1:1/unused');
const container = createContainer({
  db: database.db,
  auth: {
    secret: 'unit-tests-secret-0123456789abcdef0123',
    baseURL: 'http://localhost:3000',
    trustedOrigins: ['http://localhost:3000'],
    rateLimit: false,
  },
});
const app = createApp({
  services: container.services,
  auth: container.auth,
  corsOrigins: ['http://localhost:3000'],
  logRequests: false,
});

afterAll(() => database.close());

// Valide le format d'erreur unifié plutôt que de le caster.
const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

const readError = async (res: Response) => apiErrorSchema.parse(await res.json());

describe('app (HTTP layer, no database)', () => {
  it('GET /health answers 200', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('unknown routes use the unified error format', async () => {
    const res = await app.request('/does-not-exist');

    expect(res.status).toBe(404);
    const body = await readError(res);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('invalid params are rejected with VALIDATION_FAILED and details', async () => {
    const res = await app.request('/manhwas/not-a-uuid');

    expect(res.status).toBe(400);
    const body = await readError(res);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual([expect.objectContaining({ path: 'id' })]);
  });

  it('checks authentication before parsing the body', async () => {
    const res = await app.request('/manhwas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });

    expect(res.status).toBe(401);
  });

  it('protected routes answer 401 without a session', async () => {
    const res = await app.request('/reading/progress');

    expect(res.status).toBe(401);
    const body = await readError(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('ignores the legacy x-user-id header', async () => {
    const res = await app.request('/reading/lists', { headers: { 'x-user-id': 'someone-else' } });

    expect(res.status).toBe(401);
  });
});
