import { describe, expect, it } from 'vitest';
import { BadGatewayError, BadRequestError, NotFoundError } from '../../shared/lib/errors.js';
import { createFakeFetch, type FakeHandler } from '../../test/fake-fetch.js';
import { ImageProxyService } from './image-proxy.service.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const COVER = 'https://s4.anilist.co/file/cover.png';

const image = (body: Uint8Array<ArrayBuffer> = PNG, type = 'image/png') =>
  new Response(body, { headers: { 'Content-Type': type } });

function createService(handler: FakeHandler, maxBytes?: number) {
  const fake = createFakeFetch(handler);
  const service = new ImageProxyService({ fetch: fake.fetch, allowedHosts: ['anilist.co', ' .MangaDex.org '], maxBytes });
  return { service, calls: fake.calls };
}

describe('ImageProxyService', () => {
  it('returns the image bytes and its content type', async () => {
    const { service, calls } = createService(() => image(PNG, 'image/png; charset=binary'));

    const result = await service.fetchImage(COVER);

    expect(result).toEqual({ body: PNG, contentType: 'image/png' });
    expect(calls[0]?.init?.redirect).toBe('manual');
  });

  it.each([
    ['a host outside the allowlist', 'https://169.254.169.254/latest/meta-data'],
    ['a look-alike domain', 'https://evil-anilist.co/cover.png'],
    ['plain http', 'http://s4.anilist.co/cover.png'],
    ['a non-standard port', 'https://s4.anilist.co:8443/cover.png'],
    ['credentials in the URL', 'https://user:pass@s4.anilist.co/cover.png'],
    ['an unparsable URL', 'not a url'],
  ])('refuses %s without any network call (SSRF guard)', async (_label, url) => {
    const { service, calls } = createService(() => image());

    await expect(service.fetchImage(url)).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toHaveLength(0);
  });

  it('accepts subdomains of an allowed host (normalized allowlist)', async () => {
    const { service } = createService(() => image());

    await expect(service.fetchImage('https://uploads.mangadex.org/covers/x.png')).resolves.toMatchObject({
      contentType: 'image/png',
    });
  });

  it('follows redirects only towards allowed hosts', async () => {
    const allowed = createService(({ url }) =>
      url.pathname === '/old.png'
        ? new Response(null, { status: 302, headers: { Location: '/new.png' } })
        : image(),
    );
    await expect(allowed.service.fetchImage('https://s4.anilist.co/old.png')).resolves.toMatchObject({
      contentType: 'image/png',
    });
    expect(allowed.calls.map((call) => call.url.pathname)).toEqual(['/old.png', '/new.png']);

    const escaping = createService(() =>
      new Response(null, { status: 301, headers: { Location: 'http://127.0.0.1/admin' } }),
    );
    await expect(escaping.service.fetchImage(COVER)).rejects.toBeInstanceOf(BadRequestError);
    expect(escaping.calls).toHaveLength(1);
  });

  it('stops after too many redirects', async () => {
    const { service, calls } = createService(() =>
      new Response(null, { status: 302, headers: { Location: COVER } }),
    );

    await expect(service.fetchImage(COVER)).rejects.toBeInstanceOf(BadGatewayError);
    expect(calls).toHaveLength(4); // 1 appel initial + 3 redirections
  });

  it('refuses SVG and non-image content (script injection on our origin)', async () => {
    const svg = createService(() => image(new Uint8Array([0x3c]), 'image/svg+xml'));
    await expect(svg.service.fetchImage(COVER)).rejects.toBeInstanceOf(BadGatewayError);

    const html = createService(() => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(html.service.fetchImage(COVER)).rejects.toBeInstanceOf(BadGatewayError);
  });

  it('refuses images larger than the limit, even without a Content-Length', async () => {
    const big = new Uint8Array(2_048);
    const declared = createService(() => image(big), 1_024);
    await expect(declared.service.fetchImage(COVER)).rejects.toThrow(/exceeds 1024 bytes/);

    const streamed = createService(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(big);
              controller.close();
            },
          }),
          { headers: { 'Content-Type': 'image/png' } },
        ),
      1_024,
    );
    await expect(streamed.service.fetchImage(COVER)).rejects.toThrow(/exceeds 1024 bytes/);
  });

  it('maps upstream failures to 404 / 502', async () => {
    const missing = createService(() => new Response(null, { status: 404 }));
    await expect(missing.service.fetchImage(COVER)).rejects.toBeInstanceOf(NotFoundError);

    const forbidden = createService(() => new Response(null, { status: 403 }));
    await expect(forbidden.service.fetchImage(COVER)).rejects.toBeInstanceOf(BadGatewayError);

    const down = createService(() => {
      throw new TypeError('fetch failed');
    });
    await expect(down.service.fetchImage(COVER)).rejects.toBeInstanceOf(BadGatewayError);
  });
});
