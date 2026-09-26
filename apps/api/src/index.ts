import { hostname } from 'node:os';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createContainer } from './container.js';
import { loadEnv } from './shared/config/env.js';
import { createDatabase } from './shared/db/index.js';

export type { AppType } from './app.js';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const container = createContainer({
  db: database.db,
  auth: {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: env.CORS_ORIGINS,
  },
  integrations: {
    fetch,
    discoveryProviders: env.DISCOVERY_PROVIDERS,
    anilistUrl: env.ANILIST_API_URL,
    mangadexUrl: env.MANGADEX_API_URL,
    mangadexChapterLanguages: env.MANGADEX_CHAPTER_LANGUAGES,
    imageProxyAllowedHosts: env.IMAGE_PROXY_ALLOWED_HOSTS,
    mediaStorageDir: env.MEDIA_STORAGE_DIR,
  },
  jobs: {
    workerId: `${hostname()}:${process.pid}`,
    pollIntervalMs: env.JOBS_POLL_INTERVAL_MS,
    batchSize: env.JOBS_BATCH_SIZE,
  },
});
const app = createApp({
  services: container.services,
  auth: container.auth,
  corsOrigins: env.CORS_ORIGINS,
  scraperApiKey: env.SCRAPER_API_KEY,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port} (${env.NODE_ENV})`);
});
if (env.JOBS_WORKER_ENABLED) container.worker.start();

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down…`);
  server.close(() => {
    // Le worker termine ses tâches en cours AVANT la fermeture du pool (sinon : réservations orphelines).
    container.worker
      .stop()
      .then(() => database.close())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('Failed to shut down cleanly', error);
        process.exit(1);
      });
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
