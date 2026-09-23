import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { GenreController } from './genre.controller.js';
import {
  createGenreSchema,
  updateGenreSchema,
  genreIdParamSchema,
} from './genre.validator.js';

export const createGenreRouter = (controller: GenreController) =>
  new Hono<AppEnv>()
    .get('/', controller.getAll)
    .get('/:id', validate('param', genreIdParamSchema), controller.getById)
    .post('/', validate('json', createGenreSchema), controller.create)
    .patch(
      '/:id',
      validate('param', genreIdParamSchema),
      validate('json', updateGenreSchema),
      controller.update,
    )
    .delete('/:id', validate('param', genreIdParamSchema), controller.delete);
