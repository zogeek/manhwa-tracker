import type { Context } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import type { GenreService } from './genre.service.js';

export class GenreController {
  constructor(private readonly service: GenreService) {}

  getAll = async (c: Context<AppEnv>) => {
    const genres = await this.service.getAll();
    return c.json({ data: genres });
  };

  getById = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const genre = await this.service.getById(id);
    return c.json({ data: genre });
  };

  create = async (c: Context<AppEnv>) => {
    const data = c.req.valid('json' as never);
    const genre = await this.service.create(data);
    return c.json({ data: genre }, 201);
  };

  update = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const data = c.req.valid('json' as never);
    const genre = await this.service.update(id, data);
    return c.json({ data: genre });
  };

  delete = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    await this.service.delete(id);
    return c.body(null, 204);
  };
}
