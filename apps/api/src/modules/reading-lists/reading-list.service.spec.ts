import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../../shared/lib/errors.js';
import type { ReadingListRepository } from './reading-list.repository.js';
import type {
  NewReadingList,
  NewReadingListItem,
  ReadingList,
  ReadingListItem,
} from './reading-list.schema.js';
import { ReadingListService } from './reading-list.service.js';

class InMemoryReadingListRepository implements ReadingListRepository {
  readonly lists = new Map<string, ReadingList>();
  readonly items: ReadingListItem[] = [];

  async findAllByUser(userId: string): Promise<ReadingList[]> {
    return [...this.lists.values()].filter((list) => list.userId === userId && list.deletedAt === null);
  }

  async findById(id: string): Promise<ReadingList | null> {
    const list = this.lists.get(id);
    return list && list.deletedAt === null ? list : null;
  }

  async insert(data: NewReadingList): Promise<ReadingList> {
    const now = new Date();
    const list: ReadingList = {
      id: randomUUID(),
      userId: data.userId,
      name: data.name,
      description: data.description ?? null,
      color: data.color ?? null,
      icon: data.icon ?? null,
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.lists.set(list.id, list);
    return list;
  }

  async update(id: string, data: Partial<NewReadingList>): Promise<ReadingList | null> {
    const list = await this.findById(id);
    if (!list) return null;
    const updated: ReadingList = { ...list, ...data, id: list.id, updatedAt: new Date() };
    this.lists.set(id, updated);
    return updated;
  }

  async softDelete(id: string): Promise<ReadingList | null> {
    return this.update(id, { deletedAt: new Date() });
  }

  async findItems(listId: string): Promise<ReadingListItem[]> {
    return this.items.filter((item) => item.listId === listId);
  }

  async insertItem(data: NewReadingListItem): Promise<ReadingListItem> {
    const item: ReadingListItem = {
      id: randomUUID(),
      listId: data.listId,
      manhwaId: data.manhwaId,
      sortOrder: data.sortOrder ?? 0,
      addedAt: new Date(),
    };
    this.items.push(item);
    return item;
  }

  async deleteItem(listId: string, manhwaId: string): Promise<ReadingListItem | null> {
    const index = this.items.findIndex((item) => item.listId === listId && item.manhwaId === manhwaId);
    if (index === -1) return null;
    return this.items.splice(index, 1)[0] ?? null;
  }
}

describe('ReadingListService (ownership / IDOR)', () => {
  const alice = 'user-alice';
  const bob = 'user-bob';
  let repo: InMemoryReadingListRepository;
  let service: ReadingListService;
  let aliceListId: string;

  beforeEach(async () => {
    repo = new InMemoryReadingListRepository();
    service = new ReadingListService(repo);
    aliceListId = (await service.createList(alice, { name: 'Favoris' })).id;
  });

  it('lets the owner read the list with its items', async () => {
    const manhwaId = randomUUID();
    await service.addItem(alice, aliceListId, { manhwaId });

    const list = await service.getList(alice, aliceListId);

    expect(list.items.map((item) => item.manhwaId)).toEqual([manhwaId]);
  });

  it('forbids every operation on a list owned by someone else', async () => {
    const manhwaId = randomUUID();

    await expect(service.getList(bob, aliceListId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.updateList(bob, aliceListId, { name: 'pwned' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.deleteList(bob, aliceListId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.addItem(bob, aliceListId, { manhwaId })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.removeItem(bob, aliceListId, manhwaId)).rejects.toBeInstanceOf(ForbiddenError);

    expect(repo.lists.get(aliceListId)?.name).toBe('Favoris');
    expect(repo.items).toEqual([]);
  });

  it('answers NotFound for unknown or deleted lists', async () => {
    await expect(service.getList(alice, randomUUID())).rejects.toBeInstanceOf(NotFoundError);

    await service.deleteList(alice, aliceListId);

    await expect(service.getList(alice, aliceListId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('only returns the lists of the caller', async () => {
    await service.createList(bob, { name: 'Bob list' });

    const lists = await service.getUserLists(alice);

    expect(lists.map((list) => list.userId)).toEqual([alice]);
  });
});
