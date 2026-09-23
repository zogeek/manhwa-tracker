import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { ReadingController } from './reading.controller.js';
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

export const createReadingRouter = (controller: ReadingController) =>
  new Hono<AppEnv>()
    // Progress
    .get('/progress', controller.getAllProgress)
    .get('/progress/:manhwaId', validate('param', progressParamSchema), controller.getProgress)
    .put(
      '/progress/:manhwaId',
      validate('param', progressParamSchema),
      validate('json', updateProgressSchema),
      controller.updateProgress,
    )
    // Chapter reads
    .post('/reads', validate('json', logChapterReadSchema), controller.logRead)
    .get('/reads', controller.getReadHistory)
    .get('/reads/:manhwaId', validate('param', progressParamSchema), controller.getReadHistory)
    // Reading lists
    .get('/lists', controller.getUserLists)
    .get('/lists/:id', validate('param', readingListIdParamSchema), controller.getListById)
    .post('/lists', validate('json', createReadingListSchema), controller.createList)
    .patch(
      '/lists/:id',
      validate('param', readingListIdParamSchema),
      validate('json', updateReadingListSchema),
      controller.updateList,
    )
    .delete('/lists/:id', validate('param', readingListIdParamSchema), controller.deleteList)
    .post(
      '/lists/:id/items',
      validate('param', readingListIdParamSchema),
      validate('json', addListItemSchema),
      controller.addToList,
    )
    .delete('/lists/:id/items/:manhwaId', validate('param', listAndManhwaParamSchema), controller.removeFromList);
