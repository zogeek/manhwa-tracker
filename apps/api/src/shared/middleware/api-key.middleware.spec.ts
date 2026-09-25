import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../http/error-handler.js';
import type { AppEnv } from '../http/types.js';
import { API_KEY_HEADER, createApiKeyMiddleware } from './api-key.middleware.js';

const VALID_KEY = 'scraper-key-0123456789abcdef0123456789abcdef';

// Mini-app isolée : on teste le middleware seul, sans base de données.
const app = new Hono<AppEnv>();
app.onError(errorHandler);
app
  .use('*', createApiKeyMiddleware(VALID_KEY).requireApiKey)
  .get('/protected', (c) => c.json({ machine: c.get('machine').name }));

const call = (key?: string) =>
  app.request('/protected', key === undefined ? {} : { headers: { [API_KEY_HEADER]: key } });

describe('requireApiKey (machine-to-machine)', () => {
  it('rejects a request without the x-api-key header', async () => {
    const res = await call();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it.each([
    ['a wrong key of the same length', VALID_KEY.replace(/.$/, 'X')],
    ['a prefix of the valid key', VALID_KEY.slice(0, 10)],
    ['a longer key starting with the valid one', `${VALID_KEY}-extra`],
    ['an empty key', ''],
  ])('rejects %s', async (_label, key) => {
    expect((await call(key)).status).toBe(401);
  });

  it('accepts the configured key and exposes the machine identity', async () => {
    const res = await call(VALID_KEY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ machine: 'scraper' });
  });
});
