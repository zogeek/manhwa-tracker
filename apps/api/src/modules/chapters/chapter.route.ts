import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { ChapterService } from './chapter.service.js';
import {
  createChapterSchema,
  updateChapterSchema,
  chapterIdParamSchema,
  manhwaIdParamSchema,
} from './chapter.validator.js';

export const createChapterRoutes = (service: ChapterService, { requireAuth }: AuthMiddleware) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const chapters = await service.getAll();
      return c.json({ data: chapters }, 200);
    })
    .get('/manhwa/:manhwaId', validate('param', manhwaIdParamSchema), async (c) => {
      const { manhwaId } = c.req.valid('param');
      const chapters = await service.getByManhwaId(manhwaId);
      return c.json({ data: chapters }, 200);
    })
    .get('/:id', validate('param', chapterIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const chapter = await service.getById(id);
      return c.json({ data: chapter }, 200);
    })
    .post('/', requireAuth, validate('json', createChapterSchema), async (c) => {
      const chapter = await service.create(c.req.valid('json'), c.get('user').id);
      return c.json({ data: chapter }, 201);
    })
    .patch(
      '/:id',
      requireAuth,
      validate('param', chapterIdParamSchema),
      validate('json', updateChapterSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const chapter = await service.update(id, c.req.valid('json'), c.get('user').id);
        return c.json({ data: chapter }, 200);
      },
    )
    .delete('/:id', requireAuth, validate('param', chapterIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.delete(id, c.get('user').id);
      return c.body(null, 204);
    });
