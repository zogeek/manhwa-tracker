import { NotFoundError } from '../../shared/lib/errors.js';
import type { ReadingRepository } from './reading.repository.js';
import type {
  ChapterRead,
  ReadingList,
  ReadingListItem,
  ReadingProgress,
} from './reading.schema.js';
import type {
  AddListItemInput,
  CreateReadingListInput,
  LogChapterReadInput,
  UpdateProgressInput,
  UpdateReadingListInput,
} from './reading.validator.js';

export class ReadingService {
  constructor(private readonly repo: ReadingRepository) {}

  async getProgress(userId: string, manhwaId: string): Promise<ReadingProgress | null> {
    return this.repo.findProgressByUserAndManhwa(userId, manhwaId);
  }

  async getAllProgress(userId: string): Promise<ReadingProgress[]> {
    return this.repo.findAllProgressByUser(userId);
  }

  async updateProgress(userId: string, manhwaId: string, data: UpdateProgressInput): Promise<ReadingProgress> {
    const current = await this.getProgress(userId, manhwaId);
    const currentChapter = data.currentChapter ?? current?.currentChapter ?? 0;

    return this.repo.upsertProgress({
      userId,
      manhwaId,
      status: data.status ?? current?.status ?? 'plan_to_read',
      currentChapter,
      furthestChapter: Math.max(current?.furthestChapter ?? 0, currentChapter),
      rating: data.rating ?? current?.rating ?? null,
      notes: data.notes ?? current?.notes ?? null,
      updatedBy: userId,
    });
  }

  async logRead(userId: string, data: LogChapterReadInput): Promise<ChapterRead> {
    return this.repo.insertRead({
      userId,
      chapterId: data.chapterId,
      sourceId: data.sourceId ?? null,
      readingTimeSeconds: data.readingTimeSeconds ?? null,
    });
  }

  async getReadHistory(userId: string, manhwaId?: string): Promise<ChapterRead[]> {
    if (manhwaId) {
      return this.repo.findReadsByUserAndManhwa(userId, manhwaId);
    }
    return this.repo.findReadsByUser(userId);
  }

  async getUserLists(userId: string): Promise<ReadingList[]> {
    return this.repo.findAllListsByUser(userId);
  }

  async getListById(id: string): Promise<ReadingList> {
    const list = await this.repo.findListById(id);
    if (!list) throw new NotFoundError('ReadingList', id);
    return list;
  }

  async createList(userId: string, data: CreateReadingListInput): Promise<ReadingList> {
    return this.repo.insertList({ ...data, userId });
  }

  // TODO(étape 4) : contrôle de propriété obligatoire sur toutes les opérations de liste (IDOR).
  async updateList(id: string, data: UpdateReadingListInput, userId?: string): Promise<ReadingList> {
    const list = await this.getListById(id);
    if (userId && list.userId !== userId) throw new NotFoundError('ReadingList', id);

    const updated = await this.repo.updateList(id, data);
    if (!updated) throw new NotFoundError('ReadingList', id);
    return updated;
  }

  async deleteList(id: string, userId?: string): Promise<void> {
    const list = await this.getListById(id);
    if (userId && list.userId !== userId) throw new NotFoundError('ReadingList', id);

    const deleted = await this.repo.softDeleteList(id);
    if (!deleted) throw new NotFoundError('ReadingList', id);
  }

  async addToList(listId: string, data: AddListItemInput): Promise<ReadingListItem> {
    await this.getListById(listId);
    return this.repo.insertListItem({
      listId,
      manhwaId: data.manhwaId,
      sortOrder: data.sortOrder,
    });
  }

  async removeFromList(listId: string, manhwaId: string): Promise<void> {
    await this.getListById(listId);
    const removed = await this.repo.deleteListItem(listId, manhwaId);
    if (!removed) throw new NotFoundError('ReadingListItem', manhwaId);
  }
}
