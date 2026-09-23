import type { Context } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import type { ChapterService } from './chapter.service.js';

export class ChapterController {
  constructor(private readonly service: ChapterService) {}

  getAll = async (c: Context<AppEnv>) => {
    const chapters = await this.service.getAll();
    return c.json({ data: chapters });
  };

  getByManhwaId = async (c: Context<AppEnv>) => {
    const { manhwaId } = c.req.valid('param' as never);
    const chapters = await this.service.getByManhwaId(manhwaId);
    return c.json({ data: chapters });
  };

  getById = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const chapter = await this.service.getById(id);
    return c.json({ data: chapter });
  };

  create = async (c: Context<AppEnv>) => {
    const data = c.req.valid('json' as never);
    const chapter = await this.service.create(data, c.get('userId'));
    return c.json({ data: chapter }, 201);
  };

  update = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const data = c.req.valid('json' as never);
    const chapter = await this.service.update(id, data, c.get('userId'));
    return c.json({ data: chapter });
  };

  delete = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    await this.service.delete(id, c.get('userId'));
    return c.body(null, 204);
  };
}
