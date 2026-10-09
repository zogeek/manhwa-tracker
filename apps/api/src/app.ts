import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { Services } from './container.js';
import { createChapterRoutes } from './modules/chapters/chapter.route.js';
import { createImageRoutes } from './modules/images/image.route.js';
import { createIngestionRoutes } from './modules/ingestion/ingestion.route.js';
import { createManhwaSourceRoutes } from './modules/manhwa-sources/manhwa-source.route.js';
import { createManhwaRoutes } from './modules/manhwas/manhwa.route.js';
import { createReadingListRoutes } from './modules/reading-lists/reading-list.route.js';
import { createReadingProgressRoutes } from './modules/reading-progress/reading-progress.route.js';
import { createSourceRoutes } from './modules/sources/source.route.js';
import { createTaxonomyRoutes } from './modules/taxonomy/taxonomy.route.js';
import type { Auth } from './shared/auth/index.js';
import { errorHandler, notFoundHandler } from './shared/http/error-handler.js';
import type { AppEnv } from './shared/http/types.js';
import { createApiKeyMiddleware } from './shared/middleware/api-key.middleware.js';
import { createAuthMiddleware } from './shared/middleware/auth.middleware.js';

export type AppOptions = {
  services: Services;
  auth: Auth;
  corsOrigins: string[];
  /** Clé d'API attendue sur /api/ingest/* (worker de scraping). */
  scraperApiKey: string;
  /** Journal HTTP (désactivé dans les tests). */
  logRequests?: boolean;
};

export function createApp({ services, auth, corsOrigins, scraperApiKey, logRequests = true }: AppOptions) {
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

  // API machine-à-machine du scraper : hors AppType (le front n'a pas à connaître ce contrat).
  app.route('/api/ingest', createIngestionRoutes(services.ingestion, createApiKeyMiddleware(scraperApiKey)));

  return app
    .get('/health', (c) => c.json({ status: 'ok' }))
    .route('/sources', createSourceRoutes(services.sources, authMiddleware))
    .route('/manhwas', createManhwaRoutes(services.manhwas, services.discovery, authMiddleware))
    .route('/manhwas', createManhwaSourceRoutes(services.manhwaSources, authMiddleware))
    .route('/chapters', createChapterRoutes(services.chapters, authMiddleware))
    .route('/taxonomy', createTaxonomyRoutes(services.taxonomy, authMiddleware))
    .route('/reading', createReadingProgressRoutes(services.readingProgress, authMiddleware))
    .route('/reading/lists', createReadingListRoutes(services.readingLists, authMiddleware))
    .route('/images', createImageRoutes(services.images, services.media));
}

export type AppType = ReturnType<typeof createApp>;
