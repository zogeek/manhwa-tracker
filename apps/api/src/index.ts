import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sourceRouter } from './modules/sources/source.route.js';
import { manhwaRouter } from './modules/manhwas/manhwa.route.js';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: 'http://localhost:3000',
    credentials: true,
  }),
);

app.onError((err, c) => {
  console.error('[UNHANDLED_ERROR]', err.message, err.stack);
  return c.json({ error: 'Internal server error' }, 500);
});

const routes = app
  .get('/health', (c) => c.json({ status: 'OK' }))
  .route('/sources', sourceRouter)
  .route('/manhwas', manhwaRouter);

serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

export type AppType = typeof routes;
