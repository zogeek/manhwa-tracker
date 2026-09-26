import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFakeFetch } from '../../test/fake-fetch.js';
import { createTestContext } from '../../test/integration.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const cdn = createFakeFetch(({ url }) =>
  url.pathname.endsWith('.png')
    ? new Response(PNG, { headers: { 'Content-Type': 'image/png' } })
    : new Response(null, { status: 404 }),
);
const context = createTestContext({ fetch: cdn.fetch });

afterAll(() => context.close());

const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const proxy = (url: string) => context.client.images.proxy.$get({ query: { url } });

describe('GET /images/proxy', () => {
  it('streams an allowed image with cache and hardening headers', async () => {
    const res = await proxy('https://s4.anilist.co/file/cover.png');

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('refuses hosts outside the allowlist without fetching them (SSRF guard)', async () => {
    const before = cdn.calls.length;
    const res = await proxy('https://internal.example/secret.png');

    expect(res.status).toBe(400);
    expect(errorSchema.parse(await res.json()).error.code).toBe('BAD_REQUEST');
    expect(cdn.calls).toHaveLength(before);
  });

  it('validates the url parameter', async () => {
    const res = await proxy('http://s4.anilist.co/cover.png');

    expect(res.status).toBe(400);
    expect(errorSchema.parse(await res.json()).error.code).toBe('VALIDATION_FAILED');
  });

  it('answers 404 when the upstream image does not exist', async () => {
    expect((await proxy('https://s4.anilist.co/missing.jpg')).status).toBe(404);
  });
});
