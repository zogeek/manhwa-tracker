import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { ManhwaService } from './manhwa.service.js';
import {
  createManhwaSchema,
  updateManhwaSchema,
  manhwaIdParamSchema,
} from './manhwa.validator.js';

export const createManhwaRoutes = (service: ManhwaService, { requireAuth }: AuthMiddleware) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const manhwas = await service.getAll();
      return c.json({ data: manhwas }, 200);
    })
    .get('/:id', validate('param', manhwaIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const manhwa = await service.getById(id);
      return c.json({ data: manhwa }, 200);
    })
    .post('/', requireAuth, validate('json', createManhwaSchema), async (c) => {
      const manhwa = await service.create(c.req.valid('json'), c.get('user').id);
      return c.json({ data: manhwa }, 201);
    })
    .patch(
      '/:id',
      requireAuth,
      validate('param', manhwaIdParamSchema),
      validate('json', updateManhwaSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const manhwa = await service.update(id, c.req.valid('json'), c.get('user').id);
        return c.json({ data: manhwa }, 200);
      },
    )
    .delete('/:id', requireAuth, validate('param', manhwaIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.delete(id, c.get('user').id);
      return c.body(null, 204);
    });
