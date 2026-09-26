import type { HttpFetch } from '../shared/http/outbound.js';

export type FakeRequest = { url: URL; init: RequestInit | undefined };
export type FakeHandler = (request: FakeRequest) => Response | Promise<Response>;

/**
 * Faux `fetch` pour les tests : chaque appel est journalisé et servi par `handler`.
 * Aucun test ne sort sur le réseau (AniList, CDN d'images…).
 */
export function createFakeFetch(handler: FakeHandler) {
  const calls: FakeRequest[] = [];
  const fetch: HttpFetch = async (input, init) => {
    const request = { url: new URL(input instanceof URL ? input.href : input), init };
    calls.push(request);
    return handler(request);
  };
  return { fetch, calls };
}

/** Par défaut : tout appel sortant échoue, comme un serveur sans accès Internet. */
export const offlineFetch: HttpFetch = async (input) => {
  throw new TypeError(`Network access is disabled in tests (${String(input)})`);
};

export const TEST_INTEGRATIONS = {
  anilistUrl: 'https://graphql.anilist.test',
  imageProxyAllowedHosts: ['anilist.co', 'mangadex.org'],
};
