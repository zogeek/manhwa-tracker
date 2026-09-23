import type { Context } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import type { ManhwaService } from './manhwa.service.js';

export class ManhwaController {
  constructor(private readonly service: ManhwaService) {}

  getAll = async (c: Context<AppEnv>) => {
    const manhwas = await this.service.getAll();
    return c.json({ data: manhwas });
  };

  getById = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const manhwa = await this.service.getById(id);
    return c.json({ data: manhwa });
  };

  create = async (c: Context<AppEnv>) => {
    const data = c.req.valid('json' as never);
    const manhwa = await this.service.create(data, c.get('userId'));
    return c.json({ data: manhwa }, 201);
  };

  update = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const data = c.req.valid('json' as never);
    const manhwa = await this.service.update(id, data, c.get('userId'));
    return c.json({ data: manhwa });
  };

  delete = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    await this.service.delete(id, c.get('userId'));
    return c.body(null, 204);
  };
}
