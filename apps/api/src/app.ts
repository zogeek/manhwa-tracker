import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Container } from './container.js';
import { createChapterRouter } from './modules/chapters/chapter.route.js';
import { createGenreRouter } from './modules/genres/genre.route.js';
import { createManhwaRouter } from './modules/manhwas/manhwa.route.js';
import { createReadingRouter } from './modules/reading/reading.route.js';
import { createSourceRouter } from './modules/sources/source.route.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import type { AppEnv } from './shared/http/types.js';

export type AppOptions = {
  container: Container;
  corsOrigins: string[];
};

export function createApp({ container, corsOrigins }: AppOptions) {
  const { controllers } = container;

  const app = new Hono<AppEnv>()
    .use(requestId())
    .use(logger())
    .use(secureHeaders())
    .use(cors({ origin: corsOrigins, credentials: true }));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app
    .get('/health', (c) => c.json({ status: 'ok' }))
    .route('/sources', createSourceRouter(controllers.sources))
    .route('/manhwas', createManhwaRouter(controllers.manhwas))
    .route('/chapters', createChapterRouter(controllers.chapters))
    .route('/genres', createGenreRouter(controllers.genres))
    .route('/reading', createReadingRouter(controllers.reading));
}

export type AppType = ReturnType<typeof createApp>;
