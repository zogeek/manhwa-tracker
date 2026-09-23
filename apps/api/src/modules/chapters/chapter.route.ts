import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { ChapterController } from './chapter.controller.js';
import {
  createChapterSchema,
  updateChapterSchema,
  chapterIdParamSchema,
  manhwaIdParamSchema,
} from './chapter.validator.js';

export const createChapterRouter = (controller: ChapterController) =>
  new Hono<AppEnv>()
    .get('/', controller.getAll)
    .get('/manhwa/:manhwaId', validate('param', manhwaIdParamSchema), controller.getByManhwaId)
    .get('/:id', validate('param', chapterIdParamSchema), controller.getById)
    .post('/', validate('json', createChapterSchema), controller.create)
    .patch(
      '/:id',
      validate('param', chapterIdParamSchema),
      validate('json', updateChapterSchema),
      controller.update,
    )
    .delete('/:id', validate('param', chapterIdParamSchema), controller.delete);
