import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { SourceService } from './source.service.js';
import {
  createSourceSchema,
  updateSourceSchema,
  sourceIdParamSchema,
} from './source.validator.js';

export const createSourceRoutes = (service: SourceService, { requireAuth }: AuthMiddleware) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const sources = await service.getAll();
      return c.json({ data: sources }, 200);
    })
    .get('/:id', validate('param', sourceIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const source = await service.getById(id);
      return c.json({ data: source }, 200);
    })
    .post('/', requireAuth, validate('json', createSourceSchema), async (c) => {
      const source = await service.create(c.req.valid('json'), c.get('user').id);
      return c.json({ data: source }, 201);
    })
    .patch(
      '/:id',
      requireAuth,
      validate('param', sourceIdParamSchema),
      validate('json', updateSourceSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const source = await service.update(id, c.req.valid('json'), c.get('user').id);
        return c.json({ data: source }, 200);
      },
    )
    .delete('/:id', requireAuth, validate('param', sourceIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.delete(id, c.get('user').id);
      return c.body(null, 204);
    });
