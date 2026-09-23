import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Services } from './container.js';
import { createChapterRoutes } from './modules/chapters/chapter.route.js';
import { createGenreRoutes } from './modules/genres/genre.route.js';
import { createManhwaRoutes } from './modules/manhwas/manhwa.route.js';
import { createReadingRoutes } from './modules/reading/reading.route.js';
import { createSourceRoutes } from './modules/sources/source.route.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import type { AppEnv } from './shared/http/types.js';

export type AppOptions = {
  services: Services;
  corsOrigins: string[];
};

export function createApp({ services, corsOrigins }: AppOptions) {
  const app = new Hono<AppEnv>()
    .use(requestId())
    .use(logger())
    .use(secureHeaders())
    .use(cors({ origin: corsOrigins, credentials: true }));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app
    .get('/health', (c) => c.json({ status: 'ok' }))
    .route('/sources', createSourceRoutes(services.sources))
    .route('/manhwas', createManhwaRoutes(services.manhwas))
    .route('/chapters', createChapterRoutes(services.chapters))
    .route('/genres', createGenreRoutes(services.genres))
    .route('/reading', createReadingRoutes(services.reading));
}

export type AppType = ReturnType<typeof createApp>;
