import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { ManhwaController } from './manhwa.controller.js';
import { createManhwaSchema, manhwaIdParamSchema, updateManhwaSchema } from './manhwa.validator.js';

const controller = new ManhwaController();

const manhwaRouter = new Hono()
  .get('/', controller.getAll)
  .get('/:id', zValidator('param', manhwaIdParamSchema), controller.getById)
  .post('/', zValidator('json', createManhwaSchema), controller.create)
  .patch('/:id',
    zValidator('param', manhwaIdParamSchema),
    zValidator('json', updateManhwaSchema),
    controller.update,
  )
  .delete('/:id', zValidator('param', manhwaIdParamSchema), controller.delete);

export { manhwaRouter };