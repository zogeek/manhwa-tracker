import type { Context } from 'hono';
import { ManhwaService } from './manhwa.service.js';
import { AppError } from '../../shared/lib/errors.js';

export class ManhwaController {
  private readonly service: ManhwaService;

  constructor(service?: ManhwaService) {
    this.service = service ?? new ManhwaService();
  }

  getAll = async (c: Context): Promise<Response> => {
    const manhwas = await this.service.getAll();
    return c.json(manhwas);
  };

  getById = async (c: Context): Promise<Response> => {
    try {
      const { id } = c.req.valid('param' as never);
      const manhwa = await this.service.getById(id);
      return c.json(manhwa);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  create = async (c: Context): Promise<Response> => {
    try {
      const data = c.req.valid('json' as never);
      const userId = c.get('userId') as string | undefined;
      const manhwa = await this.service.create(data, userId);
      return c.json(manhwa, 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  update = async (c: Context): Promise<Response> => {
    try {
      const { id } = c.req.valid('param' as never);
      const data = c.req.valid('json' as never);
      const userId = c.get('userId') as string | undefined;
      const manhwa = await this.service.update(id, data, userId);
      return c.json(manhwa);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  delete = async (c: Context): Promise<Response> => {
    try {
      const { id } = c.req.valid('param' as never);
      const userId = c.get('userId') as string | undefined;
      await this.service.delete(id, userId);
      return c.json({ success: true });
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  private handleError(c: Context, error: unknown): Response {
    if (error instanceof AppError) {
      return c.json({ error: error.message }, error.statusCode as 400);
    }
    throw error;
  }
}