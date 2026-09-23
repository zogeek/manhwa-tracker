import { Hono } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { validate } from '../../shared/http/validator.js';
import type { GenreService } from './genre.service.js';
import { createGenreSchema, updateGenreSchema, genreIdParamSchema } from './genre.validator.js';

export const createGenreRoutes = (service: GenreService) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const genres = await service.getAll();
      return c.json({ data: genres }, 200);
    })
    .get('/:id', validate('param', genreIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      const genre = await service.getById(id);
      return c.json({ data: genre }, 200);
    })
    .post('/', validate('json', createGenreSchema), async (c) => {
      const genre = await service.create(c.req.valid('json'));
      return c.json({ data: genre }, 201);
    })
    .patch(
      '/:id',
      validate('param', genreIdParamSchema),
      validate('json', updateGenreSchema),
      async (c) => {
        const { id } = c.req.valid('param');
        const genre = await service.update(id, c.req.valid('json'));
        return c.json({ data: genre }, 200);
      },
    )
    .delete('/:id', validate('param', genreIdParamSchema), async (c) => {
      const { id } = c.req.valid('param');
      await service.delete(id);
      return c.body(null, 204);
    });
