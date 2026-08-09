import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { SourceController } from './source.controller.js';
import {
  createSourceSchema,
  updateSourceSchema,
  sourceIdParamSchema,
} from './source.validator.js';

const controller = new SourceController();

const sourceRouter = new Hono()
  .get('/', controller.getAll)
  .get('/:id', zValidator('param', sourceIdParamSchema), controller.getById)
  .post('/', zValidator('json', createSourceSchema), controller.create)
  .patch('/:id',
    zValidator('param', sourceIdParamSchema),
    zValidator('json', updateSourceSchema),
    controller.update,
  )
  .delete('/:id', zValidator('param', sourceIdParamSchema), controller.delete);

export { sourceRouter };