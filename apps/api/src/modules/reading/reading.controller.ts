import type { Context } from 'hono';
import { AppError } from '../../shared/lib/errors.js';
import { ReadingService } from './reading.service.js';

export class ReadingController {
  private service: ReadingService;

  constructor() {
    this.service = new ReadingService();
  }

  private handleError(c: Context, error: unknown) {
    if (error instanceof AppError) {
      return c.json({ error: error.message }, error.statusCode as any);
    }
    console.error('Reading error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }

  private getUserId(c: Context): string {
    const userId = c.get('userId') as string | undefined ?? c.req.header('x-user-id');
    if (!userId) throw new AppError(401, 'Unauthorized');
    return userId;
  }

  getAllProgress = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const progress = await this.service.getAllProgress(userId);
      return c.json(progress);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  getProgress = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const { manhwaId } = c.req.valid('param' as never) as { manhwaId: string };
      const progress = await this.service.getProgress(userId, manhwaId);
      return c.json(progress || { message: 'No progress found' });
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  updateProgress = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const { manhwaId } = c.req.valid('param' as never) as { manhwaId: string };
      const data = c.req.valid('json' as never);
      const progress = await this.service.updateProgress(userId, manhwaId, data as any);
      return c.json(progress);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  logRead = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const data = c.req.valid('json' as never);
      const read = await this.service.logRead(userId, data as any);
      return c.json(read, 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  getReadHistory = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      // It will be parsed conditionally based on route definition
      const params = c.req.param();
      const manhwaId = params.manhwaId;
      const history = await this.service.getReadHistory(userId, manhwaId);
      return c.json(history);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  getUserLists = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const lists = await this.service.getUserLists(userId);
      return c.json(lists);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  getListById = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never) as { id: string };
      const list = await this.service.getListById(id);
      return c.json(list);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  createList = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const data = c.req.valid('json' as never);
      const list = await this.service.createList(userId, data as any);
      return c.json(list, 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  updateList = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const { id } = c.req.valid('param' as never) as { id: string };
      const data = c.req.valid('json' as never);
      const list = await this.service.updateList(id, data as any, userId);
      return c.json(list);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  deleteList = async (c: Context) => {
    try {
      const userId = this.getUserId(c);
      const { id } = c.req.valid('param' as never) as { id: string };
      await this.service.deleteList(id, userId);
      return c.json({ success: true });
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  addToList = async (c: Context) => {
    try {
      const { id } = c.req.valid('param' as never) as { id: string };
      const data = c.req.valid('json' as never);
      const item = await this.service.addToList(id, data as any);
      return c.json(item, 201);
    } catch (error) {
      return this.handleError(c, error);
    }
  };

  removeFromList = async (c: Context) => {
    try {
      const { id, manhwaId } = c.req.valid('param' as never) as { id: string, manhwaId: string };
      await this.service.removeFromList(id, manhwaId);
      return c.json({ success: true });
    } catch (error) {
      return this.handleError(c, error);
    }
  };
}
