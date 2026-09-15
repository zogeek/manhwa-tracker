import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sourceRouter } from './modules/sources/source.route.js';
import { manhwaRouter } from './modules/manhwas/manhwa.route.js';
import { chapterRouter } from './modules/chapters/chapter.route.js';
import { genresRouter as genreRouter } from './modules/genres/genre.route.js';
import { readingRouter } from './modules/reading/reading.route.js';

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
  .route('/manhwas', manhwaRouter)
  .route('/chapters', chapterRouter)
  .route('/genres', genreRouter)
  .route('/reading', readingRouter);

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
