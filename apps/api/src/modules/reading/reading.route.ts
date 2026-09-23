import { Hono, type Context } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import { UnauthorizedError } from '../../shared/lib/errors.js';
import type { ReadingService } from './reading.service.js';
import {
  updateProgressSchema,
  logChapterReadSchema,
  createReadingListSchema,
  updateReadingListSchema,
  addListItemSchema,
  progressParamSchema,
  readingListIdParamSchema,
  listAndManhwaParamSchema,
} from './reading.validator.js';

// FIXME(auth) : le fallback sur le header `x-user-id` permet d'usurper n'importe quel utilisateur
// (interdit par CLAUDE.md). À remplacer par `requireAuth` dès que Better Auth est en place.
function requireUserId(c: Context<AppEnv>): string {
  const userId = c.get('userId') ?? c.req.header('x-user-id');
  if (!userId) throw new UnauthorizedError();
  return userId;
}

export const createReadingRoutes = (service: ReadingService) =>
  new Hono<AppEnv>()
    // Progress
    .get('/progress', async (c) => {
      const progress = await service.getAllProgress(requireUserId(c));
      return c.json({ data: progress }, 200);
    })
    .get('/progress/:manhwaId', validate('param', progressParamSchema), async (c) => {
      const { manhwaId } = c.req.valid('param');
      const progress = await service.getProgress(requireUserId(c), manhwaId);
      return c.json({ data: progress }, 200);
    })
    .put(
      '/progress/:manhwaId',
      validate('param', progressParamSchema),
      validate('json', updateProgressSchema),
      async (c) => {
        const { manhwaId } = c.req.valid('param');
        const progress = await service.updateProgress(requireUserId(c), manhwaId, c.req.valid('json'));
        return c.json({ data: progress }, 200);
      },
    )
    // Chapter reads
    .post('/reads', validate('json', logChapterReadSchema), async (c) => {
      const read = await service.logRead(requireUserId(c), c.req.valid('json'));
      return c.json({ data: read }, 201);
    })
    .get('/reads', async (c) => {
      const history = await service.getReadHistory(requireUserId(c));
      return c.json({ data: history }, 200);
    })
    .get('/reads/:manhwaId', validate('param', progressParamSchema), async (c) => {
      const { manhwaId } = c.req.valid('param');
      const history = await service.getReadHistory(requireUserId(c), manhwaId);
      return c.json({ data: history }, 200);
    })
    // Reading lists
    .get('/lists', async (c) => {
      const lists = await service.getUserLists(requireUserId(c));
      return c.json({ data: lists }, 200);
    })
    .get('/lists/:id', validate('param', readingListIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const list = await service.getListById(id);
      return c.json({ data: list }, 200);
    })
    .post('/lists', validate('json', createReadingListSchema), async (c) => {
      const list = await service.createList(requireUserId(c), c.req.valid('json'));
      return c.json({ data: list }, 201);
    })
    .patch(
      '/lists/:id',
      validate('param', readingListIdParamSchema),
      validate('json', updateReadingListSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const list = await service.updateList(id, c.req.valid('json'), requireUserId(c));
        return c.json({ data: list }, 200);
      },
    )
    .delete('/lists/:id', validate('param', readingListIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.deleteList(id, requireUserId(c));
      return c.body(null, 204);
    })
    .post(
      '/lists/:id/items',
      validate('param', readingListIdParamSchema),
      validate('json', addListItemSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const item = await service.addToList(id, c.req.valid('json'));
        return c.json({ data: item }, 201);
      },
    )
    .delete('/lists/:id/items/:manhwaId', validate('param', listAndManhwaParamSchema), async (c) => {
      const { id, manhwaId } = c.req.valid('param');
      await service.removeFromList(id, manhwaId);
      return c.body(null, 204);
    });
