import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { AuthMiddleware } from '../../shared/middleware/auth.middleware.js';
import type { ReadingListService } from './reading-list.service.js';
import {
  addListItemSchema,
  createReadingListSchema,
  listIdParamSchema,
  listItemParamSchema,
  updateReadingListSchema,
} from './reading-list.validator.js';

/** Données personnelles : toutes les routes exigent une session, la propriété est vérifiée par le service. */
export const createReadingListRoutes = (service: ReadingListService, { requireAuth }: AuthMiddleware) =>
  new Hono<AppEnv>()
    .get('/', requireAuth, async (c) => {
      const lists = await service.getUserLists(c.get('user').id);
      return c.json({ data: lists }, 200);
    })
    .get('/:id', requireAuth, validate('param', listIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const list = await service.getList(c.get('user').id, id);
      return c.json({ data: list }, 200);
    })
    .post('/', requireAuth, validate('json', createReadingListSchema), async (c) => {
      const list = await service.createList(c.get('user').id, c.req.valid('json'));
      return c.json({ data: list }, 201);
    })
    .patch(
      '/:id',
      requireAuth,
      validate('param', listIdParamSchema),
      validate('json', updateReadingListSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const list = await service.updateList(c.get('user').id, id, c.req.valid('json'));
        return c.json({ data: list }, 200);
      },
    )
    .delete('/:id', requireAuth, validate('param', listIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.deleteList(c.get('user').id, id);
      return c.body(null, 204);
    })
    .post(
      '/:id/items',
      requireAuth,
      validate('param', listIdParamSchema),
      validate('json', addListItemSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const item = await service.addItem(c.get('user').id, id, c.req.valid('json'));
        return c.json({ data: item }, 201);
      },
    )
    .delete('/:id/items/:manhwaId', requireAuth, validate('param', listItemParamSchema), async (c) => {
      const { id, manhwaId } = c.req.valid('param');
      await service.removeItem(c.get('user').id, id, manhwaId);
      return c.body(null, 204);
    });
