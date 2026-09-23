import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { ManhwaController } from './manhwa.controller.js';
import {
  createManhwaSchema,
  updateManhwaSchema,
  manhwaIdParamSchema,
} from './manhwa.validator.js';

export const createManhwaRouter = (controller: ManhwaController) =>
  new Hono<AppEnv>()
    .get('/', controller.getAll)
    .get('/:id', validate('param', manhwaIdParamSchema), controller.getById)
    .post('/', validate('json', createManhwaSchema), controller.create)
    .patch(
      '/:id',
      validate('param', manhwaIdParamSchema),
      validate('json', updateManhwaSchema),
      controller.update,
    )
    .delete('/:id', validate('param', manhwaIdParamSchema), controller.delete);
