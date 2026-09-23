import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { SourceController } from './source.controller.js';
import {
  createSourceSchema,
  updateSourceSchema,
  sourceIdParamSchema,
} from './source.validator.js';

export const createSourceRouter = (controller: SourceController) =>
  new Hono<AppEnv>()
    .get('/', controller.getAll)
    .get('/:id', validate('param', sourceIdParamSchema), controller.getById)
    .post('/', validate('json', createSourceSchema), controller.create)
    .patch(
      '/:id',
      validate('param', sourceIdParamSchema),
      validate('json', updateSourceSchema),
      controller.update,
    )
    .delete('/:id', validate('param', sourceIdParamSchema), controller.delete);
