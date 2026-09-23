import type { Context } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import type { SourceService } from './source.service.js';

export class SourceController {
  constructor(private readonly service: SourceService) {}

  getAll = async (c: Context<AppEnv>) => {
    const sources = await this.service.getAll();
    return c.json({ data: sources });
  };

  getById = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const source = await this.service.getById(id);
    return c.json({ data: source });
  };

  create = async (c: Context<AppEnv>) => {
    const data = c.req.valid('json' as never);
    const source = await this.service.create(data, c.get('userId'));
    return c.json({ data: source }, 201);
  };

  update = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const data = c.req.valid('json' as never);
    const source = await this.service.update(id, data, c.get('userId'));
    return c.json({ data: source });
  };

  delete = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    await this.service.delete(id, c.get('userId'));
    return c.body(null, 204);
  };
}
