import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { ManhwaService } from './manhwa.service.js';
import {
  createManhwaSchema,
  updateManhwaSchema,
  manhwaIdParamSchema,
} from './manhwa.validator.js';

export const createManhwaRoutes = (service: ManhwaService) =>
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
    .post('/', validate('json', createManhwaSchema), async (c) => {
      const manhwa = await service.create(c.req.valid('json'), c.get('userId'));
      return c.json({ data: manhwa }, 201);
    })
    .patch(
      '/:id',
      validate('param', manhwaIdParamSchema),
      validate('json', updateManhwaSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const manhwa = await service.update(id, c.req.valid('json'), c.get('userId'));
        return c.json({ data: manhwa }, 200);
      },
    )
    .delete('/:id', validate('param', manhwaIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.delete(id, c.get('userId'));
      return c.body(null, 204);
    });
