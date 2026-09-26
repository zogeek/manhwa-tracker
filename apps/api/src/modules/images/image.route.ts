import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { ImageProxyService } from './image-proxy.service.js';
import { imageProxyQuerySchema } from './image.validator.js';

/** Proxy d'images public (lecture seule), limité aux domaines de la liste blanche. */
export const createImageRoutes = (service: ImageProxyService) =>
  new Hono<AppEnv>().get('/proxy', validate('query', imageProxyQuerySchema), async (c) => {
    const image = await service.fetchImage(c.req.valid('query').url);
    return c.body(image.body, 200, {
      'Content-Type': image.contentType,
      // Une couverture change rarement : cache navigateur/CDN d'un jour, resservie périmée une semaine.
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      // Défense en profondeur : même ouverte directement, la réponse ne peut rien exécuter.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
  });
