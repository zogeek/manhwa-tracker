import { readBodyWithLimit, type HttpFetch } from '../../shared/http/outbound.js';
import { BadGatewayError, BadRequestError, NotFoundError } from '../../shared/lib/errors.js';

export type ImageProxyOptions = {
  fetch: HttpFetch;
  /** Domaines autorisés (sous-domaines inclus) : le proxy n'est PAS un relais ouvert. */
  allowedHosts: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
};

export type ProxiedImage = {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
};

// Formats matriciels uniquement : un SVG peut embarquer du JavaScript exécuté sur NOTRE origine.
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/**
 * Récupère une image tierce côté serveur (contourne l'anti-hotlinking et le CORS des sources).
 * Garde-fous anti-SSRF : HTTPS, port standard, liste blanche de domaines revérifiée à chaque
 * redirection, délai maximal, taille maximale et type de contenu contrôlés.
 */
export class ImageProxyService {
  private readonly allowedHosts: string[];
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;

  constructor(private readonly options: ImageProxyOptions) {
    this.allowedHosts = options.allowedHosts
      .map((host) => host.trim().toLowerCase().replace(/^\.+/, ''))
      .filter((host) => host.length > 0);
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxRedirects = options.maxRedirects ?? 3;
  }

  async fetchImage(rawUrl: string): Promise<ProxiedImage> {
    let url = this.assertAllowed(URL.parse(rawUrl));

    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const res = await this.options
        .fetch(url, {
          // Redirections suivies à la main : chaque destination repasse par la liste blanche.
          redirect: 'manual',
          headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
          signal: AbortSignal.timeout(this.timeoutMs),
        })
        .catch((error: unknown) => {
          throw new BadGatewayError(`Image host ${url.hostname} is unreachable`, { cause: error });
        });

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        url = this.assertAllowed(URL.parse(location, url.href));
        continue;
      }

      if (res.status === 404 || res.status === 410) {
        await res.body?.cancel();
        throw new NotFoundError('Image', url.href);
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new BadGatewayError(`Image host answered HTTP ${res.status}`);
      }

      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        await res.body?.cancel();
        throw new BadGatewayError(`Upstream resource is not a supported image (${contentType || 'unknown type'})`);
      }

      return { body: await readBodyWithLimit(res, this.maxBytes), contentType };
    }

    throw new BadGatewayError(`Too many redirects (more than ${this.maxRedirects})`);
  }

  private assertAllowed(url: URL | null): URL {
    if (!url) throw new BadRequestError('Invalid image URL');
    if (url.protocol !== 'https:') throw new BadRequestError('Only https image URLs are allowed');
    if (url.username || url.password) throw new BadRequestError('Credentials in image URLs are not allowed');
    if (url.port !== '' && url.port !== '443') throw new BadRequestError('Non-standard ports are not allowed');

    const host = url.hostname.toLowerCase();
    const allowed = this.allowedHosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
    if (!allowed) throw new BadRequestError(`Image host "${host}" is not allowed`);
    return url;
  }
}
