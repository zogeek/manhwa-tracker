import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { GenreController } from './genre.controller.js';
import { GenreService } from './genre.service.js';
import { GenreRepository } from './genre.repository.js';
import { createGenreSchema, updateGenreSchema, genreIdParamSchema } from './genre.validator.js';

export const genresRouter = new Hono();

const repository = new GenreRepository();
const service = new GenreService(repository);
const controller = new GenreController(service);

genresRouter.get(
  '/',
  controller.getAll
);

genresRouter.get(
  '/:id',
  zValidator('param', genreIdParamSchema),
  controller.getById
);

genresRouter.post(
  '/',
  zValidator('json', createGenreSchema),
  controller.create
);

genresRouter.patch(
  '/:id',
  zValidator('param', genreIdParamSchema),
  zValidator('json', updateGenreSchema),
  controller.update
);

genresRouter.delete(
  '/:id',
  zValidator('param', genreIdParamSchema),
  controller.delete
);
