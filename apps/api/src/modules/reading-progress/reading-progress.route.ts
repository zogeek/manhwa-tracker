import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { ReadingProgressService } from './reading-progress.service.js';
import {
  logChapterReadSchema,
  manhwaIdParamSchema,
  updateProgressSchema,
} from './reading-progress.validator.js';

/** Données personnelles : toutes les routes exigent une session. */
export const createReadingProgressRoutes = (
  service: ReadingProgressService,
  { requireAuth }: AuthMiddleware,
) =>
  new Hono<AppEnv>()
    // Progress
    .get('/progress', requireAuth, async (c) => {
      const progress = await service.getAllProgress(c.get('user').id);
      return c.json({ data: progress }, 200);
    })
    .get('/progress/:manhwaId', requireAuth, validate('param', manhwaIdParamSchema), async (c) => {
      const { manhwaId } = c.req.valid('param');
      const progress = await service.getProgress(c.get('user').id, manhwaId);
      return c.json({ data: progress }, 200);
    })
    .put(
      '/progress/:manhwaId',
      requireAuth,
      validate('param', manhwaIdParamSchema),
      validate('json', updateProgressSchema),
      async (c) => {
        const { manhwaId } = c.req.valid('param');
        const progress = await service.updateProgress(c.get('user').id, manhwaId, c.req.valid('json'));
        return c.json({ data: progress }, 200);
      },
    )
    .delete('/progress/:manhwaId', requireAuth, validate('param', manhwaIdParamSchema), async (c) => {
      const { manhwaId } = c.req.valid('param');
      await service.removeProgress(c.get('user').id, manhwaId);
      return c.body(null, 204);
    })
    // Chapter reads
    .post('/reads', requireAuth, validate('json', logChapterReadSchema), async (c) => {
      const logged = await service.logRead(c.get('user').id, c.req.valid('json'));
      return c.json({ data: logged }, 201);
    })
    .get('/reads', requireAuth, async (c) => {
      const history = await service.getReadHistory(c.get('user').id);
      return c.json({ data: history }, 200);
    })
    .get('/reads/:manhwaId', requireAuth, validate('param', manhwaIdParamSchema), async (c) => {
      const { manhwaId } = c.req.valid('param');
      const history = await service.getReadHistory(c.get('user').id, manhwaId);
      return c.json({ data: history }, 200);
    });
