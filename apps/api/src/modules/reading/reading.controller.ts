import type { Context } from 'hono';
import type { AppEnv } from '../../shared/http/types.js';
import { UnauthorizedError } from '../../shared/lib/errors.js';
import type { ReadingService } from './reading.service.js';

export class ReadingController {
  constructor(private readonly service: ReadingService) {}

  // FIXME(auth) : le fallback sur le header `x-user-id` permet d'usurper n'importe quel utilisateur.
  // À supprimer dès que le middleware Better Auth renseigne `userId`.
  private getUserId(c: Context<AppEnv>): string {
    const userId = c.get('userId') ?? c.req.header('x-user-id');
    if (!userId) throw new UnauthorizedError();
    return userId;
  }

  getAllProgress = async (c: Context<AppEnv>) => {
    const progress = await this.service.getAllProgress(this.getUserId(c));
    return c.json({ data: progress });
  };

  getProgress = async (c: Context<AppEnv>) => {
    const { manhwaId } = c.req.valid('param' as never);
    const progress = await this.service.getProgress(this.getUserId(c), manhwaId);
    return c.json({ data: progress });
  };

  updateProgress = async (c: Context<AppEnv>) => {
    const userId = this.getUserId(c);
    const { manhwaId } = c.req.valid('param' as never);
    const data = c.req.valid('json' as never);
    const progress = await this.service.updateProgress(userId, manhwaId, data);
    return c.json({ data: progress });
  };

  logRead = async (c: Context<AppEnv>) => {
    const userId = this.getUserId(c);
    const data = c.req.valid('json' as never);
    const read = await this.service.logRead(userId, data);
    return c.json({ data: read }, 201);
  };

  getReadHistory = async (c: Context<AppEnv>) => {
    const userId = this.getUserId(c);
    // `manhwaId` n'est présent (et validé) que sur la route `/reads/:manhwaId`.
    const manhwaId = c.req.param('manhwaId');
    const history = await this.service.getReadHistory(userId, manhwaId);
    return c.json({ data: history });
  };

  getUserLists = async (c: Context<AppEnv>) => {
    const lists = await this.service.getUserLists(this.getUserId(c));
    return c.json({ data: lists });
  };

  getListById = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const list = await this.service.getListById(id);
    return c.json({ data: list });
  };

  createList = async (c: Context<AppEnv>) => {
    const userId = this.getUserId(c);
    const data = c.req.valid('json' as never);
    const list = await this.service.createList(userId, data);
    return c.json({ data: list }, 201);
  };

  updateList = async (c: Context<AppEnv>) => {
    const userId = this.getUserId(c);
    const { id } = c.req.valid('param' as never);
    const data = c.req.valid('json' as never);
    const list = await this.service.updateList(id, data, userId);
    return c.json({ data: list });
  };

  deleteList = async (c: Context<AppEnv>) => {
    const userId = this.getUserId(c);
    const { id } = c.req.valid('param' as never);
    await this.service.deleteList(id, userId);
    return c.body(null, 204);
  };

  addToList = async (c: Context<AppEnv>) => {
    const { id } = c.req.valid('param' as never);
    const data = c.req.valid('json' as never);
    const item = await this.service.addToList(id, data);
    return c.json({ data: item }, 201);
  };

  removeFromList = async (c: Context<AppEnv>) => {
    const { id, manhwaId } = c.req.valid('param' as never);
    await this.service.removeFromList(id, manhwaId);
    return c.body(null, 204);
  };
}
