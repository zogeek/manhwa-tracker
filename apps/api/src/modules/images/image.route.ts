import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { ImageProxyService } from './image-proxy.service.js';
import { imageProxyQuerySchema, mediaKeyParamSchema } from './image.validator.js';
import type { MediaService } from './media.service.js';

// Défense en profondeur : même ouverte directement, une image servie par nous ne peut rien exécuter.
const HARDENING_HEADERS = { 'Content-Security-Policy': "default-src 'none'; sandbox" };

/** Images publiques (lecture seule) : proxy vers les domaines autorisés et copies locales. */
export const createImageRoutes = (service: ImageProxyService, media: MediaService) =>
  new Hono<AppEnv>()
    .get('/proxy', validate('query', imageProxyQuerySchema), async (c) => {
      const image = await service.fetchImage(c.req.valid('query').url);
      return c.body(image.body, 200, {
        ...HARDENING_HEADERS,
        'Content-Type': image.contentType,
        // Une couverture change rarement : cache navigateur/CDN d'un jour, resservie périmée une semaine.
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      });
    })
    .get('/media/:key', validate('param', mediaKeyParamSchema), async (c) => {
      const file = await media.getFile(c.req.valid('param').key);
      return c.body(file.body, 200, {
        ...HARDENING_HEADERS,
        'Content-Type': file.contentType,
        // Clé adressée par contenu : son contenu ne change jamais, cache « pour toujours ».
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
    });
