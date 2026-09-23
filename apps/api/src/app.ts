import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Services } from './container.js';
import { createChapterRoutes } from './modules/chapters/chapter.route.js';
import { createGenreRoutes } from './modules/genres/genre.route.js';
import { createManhwaRoutes } from './modules/manhwas/manhwa.route.js';
import { createReadingListRoutes } from './modules/reading-lists/reading-list.route.js';
import { createReadingProgressRoutes } from './modules/reading-progress/reading-progress.route.js';
import { createSourceRoutes } from './modules/sources/source.route.js';
import type { Auth } from './shared/auth/index.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import type { AppEnv } from './shared/http/types.js';
import { createAuthMiddleware } from './shared/middleware/auth.middleware.js';

export type AppOptions = {
  services: Services;
  auth: Auth;
  corsOrigins: string[];
  /** Journal HTTP (désactivé dans les tests). */
  logRequests?: boolean;
};

export function createApp({ services, auth, corsOrigins, logRequests = true }: AppOptions) {
  const authMiddleware = createAuthMiddleware(auth);

  const app = new Hono<AppEnv>().use(requestId());
  if (logRequests) app.use(logger());
  app
    .use(secureHeaders())
    .use(cors({ origin: corsOrigins, credentials: true }));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  // Endpoints Better Auth (sign-up, sign-in, session, sign-out…) : hors AppType, consommés par le client Better Auth.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

  return app
    .get('/health', (c) => c.json({ status: 'ok' }))
    .route('/sources', createSourceRoutes(services.sources))
    .route('/manhwas', createManhwaRoutes(services.manhwas))
    .route('/chapters', createChapterRoutes(services.chapters))
    .route('/genres', createGenreRoutes(services.genres))
    .route('/reading', createReadingProgressRoutes(services.readingProgress, authMiddleware))
    .route('/reading/lists', createReadingListRoutes(services.readingLists, authMiddleware));
}

export type AppType = ReturnType<typeof createApp>;
