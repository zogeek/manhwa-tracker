import { ForbiddenError, NotFoundError } from '../../shared/lib/errors.js';
import type { ReadingListRepository } from './reading-list.repository.js';
import type { ReadingList, ReadingListItem, ReadingListWithItems } from './reading-list.schema.js';
import type {
  AddListItemInput,
  CreateReadingListInput,
  UpdateReadingListInput,
} from './reading-list.validator.js';

/**
 * Toute opération sur une liste existante passe par `getOwnedList` : l'appelant doit en être
 * le propriétaire (protection IDOR). `userId` est toujours obligatoire.
 */
export class ReadingListService {
  constructor(private readonly repo: ReadingListRepository) {}

  async getUserLists(userId: string): Promise<ReadingList[]> {
    return this.repo.findAllByUser(userId);
  }

  async getList(userId: string, listId: string): Promise<ReadingListWithItems> {
    const list = await this.getOwnedList(userId, listId);
    const items = await this.repo.findItems(list.id);
    return { ...list, items };
  }

  async createList(userId: string, data: CreateReadingListInput): Promise<ReadingList> {
    return this.repo.insert({ ...data, userId });
  }

  async updateList(userId: string, listId: string, data: UpdateReadingListInput): Promise<ReadingList> {
    await this.getOwnedList(userId, listId);
    const updated = await this.repo.update(listId, data);
    if (!updated) throw new NotFoundError('ReadingList', listId);
    return updated;
  }

  async deleteList(userId: string, listId: string): Promise<void> {
    await this.getOwnedList(userId, listId);
    const deleted = await this.repo.softDelete(listId);
    if (!deleted) throw new NotFoundError('ReadingList', listId);
  }

  async addItem(userId: string, listId: string, data: AddListItemInput): Promise<ReadingListItem> {
    await this.getOwnedList(userId, listId);
    return this.repo.insertItem({ listId, manhwaId: data.manhwaId, sortOrder: data.sortOrder });
  }

  async removeItem(userId: string, listId: string, manhwaId: string): Promise<void> {
    await this.getOwnedList(userId, listId);
    const removed = await this.repo.deleteItem(listId, manhwaId);
    if (!removed) throw new NotFoundError('ReadingListItem', manhwaId);
  }

  private async getOwnedList(userId: string, listId: string): Promise<ReadingList> {
    const list = await this.repo.findById(listId);
    if (!list) throw new NotFoundError('ReadingList', listId);
    if (list.userId !== userId) throw new ForbiddenError('You do not own this reading list');
    return list;
  }
}
