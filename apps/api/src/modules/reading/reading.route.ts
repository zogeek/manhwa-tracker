import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ReadingController } from './reading.controller.js';
import {
  updateProgressSchema,
  logChapterReadSchema,
  createReadingListSchema,
  updateReadingListSchema,
  addListItemSchema,
  progressParamSchema,
  readingListIdParamSchema,
  listAndManhwaParamSchema
} from './reading.validator.js';

const router = new Hono();
const controller = new ReadingController();

// Progress
router.get('/progress', controller.getAllProgress);
router.get('/progress/:manhwaId', zValidator('param', progressParamSchema), controller.getProgress);
router.put('/progress/:manhwaId', zValidator('param', progressParamSchema), zValidator('json', updateProgressSchema), controller.updateProgress);

// Chapter Reads
router.post('/reads', zValidator('json', logChapterReadSchema), controller.logRead);
router.get('/reads', controller.getReadHistory);
router.get('/reads/:manhwaId', zValidator('param', progressParamSchema), controller.getReadHistory);

// Reading Lists
router.get('/lists', controller.getUserLists);
router.get('/lists/:id', zValidator('param', readingListIdParamSchema), controller.getListById);
router.post('/lists', zValidator('json', createReadingListSchema), controller.createList);
router.patch('/lists/:id', zValidator('param', readingListIdParamSchema), zValidator('json', updateReadingListSchema), controller.updateList);
router.delete('/lists/:id', zValidator('param', readingListIdParamSchema), controller.deleteList);

router.post('/lists/:id/items', zValidator('param', readingListIdParamSchema), zValidator('json', addListItemSchema), controller.addToList);
router.delete('/lists/:id/items/:manhwaId', zValidator('param', listAndManhwaParamSchema), controller.removeFromList);

export { router as readingRouter };
