import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ChapterController } from './chapter.controller.js';
import {
  createChapterSchema,
  updateChapterSchema,
  chapterIdParamSchema,
  manhwaIdParamSchema,
} from './chapter.validator.js';

export const chapterRouter = new Hono();
const controller = new ChapterController();

chapterRouter.get('/', controller.getAll);

chapterRouter.get(
  '/manhwa/:manhwaId',
  zValidator('param', manhwaIdParamSchema),
  controller.getByManhwaId
);

chapterRouter.get(
  '/:id',
  zValidator('param', chapterIdParamSchema),
  controller.getById
);

chapterRouter.post(
  '/',
  zValidator('json', createChapterSchema),
  controller.create
);

chapterRouter.patch(
  '/:id',
  zValidator('param', chapterIdParamSchema),
  zValidator('json', updateChapterSchema),
  controller.update
);

chapterRouter.delete(
  '/:id',
  zValidator('param', chapterIdParamSchema),
  controller.delete
);
