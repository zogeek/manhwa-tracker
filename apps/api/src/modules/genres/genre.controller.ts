import type { Context } from 'hono';
import { GenreService } from './genre.service.js';

export class GenreController {
  constructor(private readonly genreService: GenreService) {}

  getAll = async (c: Context) => {
    try {
      const genres = await this.genreService.getAll();
      return c.json({ data: genres });
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  getById = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never);
      const genre = await this.genreService.getById(id);
      return c.json({ data: genre });
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  create = async (c: Context) => {
    try {
      const data = c.req.valid('json' as never);
      const genre = await this.genreService.create(data);
      return c.json({ data: genre }, 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  update = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never);
      const data = c.req.valid('json' as never);
      const genre = await this.genreService.update(id, data);
      return c.json({ data: genre });
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  delete = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never);
      await this.genreService.delete(id);
      return c.body(null, 204);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  private handleError(c: Context, error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const status = (error as any).statusCode || 500;
      const message = (error as any).message || 'Internal Server Error';
      return c.json({ error: { message } }, status as any);
    }
    
    console.error('Unhandled error:', error);
    return c.json({ error: { message: 'Internal server error' } }, 500);
  }
}
