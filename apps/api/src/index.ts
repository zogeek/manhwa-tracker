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
    anilistUrl: env.ANILIST_API_URL,
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

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received, shutting down…`);
  server.close(() => {
    database
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('Failed to close the database pool', error);
        process.exit(1);
      });
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
