import type { Context } from 'hono';
import { AppError } from '../../shared/lib/errors.js';
import { ChapterService } from './chapter.service.js';

export class ChapterController {
  constructor(private readonly service = new ChapterService()) {}

  private handleError(c: Context, error: unknown) {
    if (error instanceof AppError) {
      return c.json({ error: error.message }, error.statusCode as any);
    }
    return c.json({ error: 'Internal Server Error' }, 500);
  }

  getAll = async (c: Context) => {
    try {
      const chapters = await this.service.getAll();
      return c.json(chapters);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  getByManhwaId = async (c: Context) => {
    try {
      const { manhwaId } = c.req.valid('param' as never) as any;
      const chapters = await this.service.getByManhwaId(manhwaId);
      return c.json(chapters);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  getById = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never) as any;
      const chapter = await this.service.getById(id);
      return c.json(chapter);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  create = async (c: Context) => {
    try {
      const body = c.req.valid('json' as never) as any;
      const chapter = await this.service.create(body);
      return c.json(chapter, 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  update = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never) as any;
      const body = c.req.valid('json' as never) as any;
      const chapter = await this.service.update(id, body);
      return c.json(chapter);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  delete = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never) as any;
      await this.service.delete(id);
      return new Response(null, { status: 204 });
    } catch (error) {
      return this.handleError(c, error);
    }
  };
}
