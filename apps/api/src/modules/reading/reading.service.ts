import { NotFoundError } from '../../shared/lib/errors.js';
import { ReadingRepository } from './reading.repository.js';
import type { LogChapterReadInput, UpdateProgressInput, CreateReadingListInput, UpdateReadingListInput, AddListItemInput } from './reading.validator.js';

export class ReadingService {
  private repository: ReadingRepository;

  constructor() {
    this.repository = new ReadingRepository();
  }

  async getProgress(userId: string, manhwaId: string) {
    return this.repository.findProgressByUserAndManhwa(userId, manhwaId);
  }

  async getAllProgress(userId: string) {
    return this.repository.findAllProgressByUser(userId);
  }

  async updateProgress(userId: string, manhwaId: string, data: UpdateProgressInput) {
    const currentProgress = await this.getProgress(userId, manhwaId);
    return this.repository.upsertProgress({
      userId,
      manhwaId,
      status: data.status || currentProgress?.status || 'plan_to_read',
      currentChapter: data.currentChapter ?? currentProgress?.currentChapter ?? 0,
      furthestChapter: currentProgress?.furthestChapter 
        ? Math.max(currentProgress.furthestChapter, data.currentChapter ?? 0)
        : (data.currentChapter ?? 0),
      rating: data.rating !== undefined ? data.rating : currentProgress?.rating,
      notes: data.notes !== undefined ? data.notes : currentProgress?.notes,
      updatedBy: userId,
    });
  }

  async logRead(userId: string, data: LogChapterReadInput) {
    const read = await this.repository.insertRead({
      userId,
      chapterId: data.chapterId,
      sourceId: data.sourceId,
      readingTimeSeconds: data.readingTimeSeconds,
    });
    return read;
  }

  async getReadHistory(userId: string, manhwaId?: string) {
    if (manhwaId) {
      return this.repository.findReadsByUserAndManhwa(userId, manhwaId);
    }
    return this.repository.findReadsByUser(userId);
  }

  async getUserLists(userId: string) {
    return this.repository.findAllListsByUser(userId);
  }

  async getListById(id: string) {
    const list = await this.repository.findListById(id);
    if (!list) {
      throw new NotFoundError('ReadingList', id);
    }
    return list;
  }

  async createList(userId: string, data: CreateReadingListInput) {
    return this.repository.insertList({
      ...data,
      userId,
    });
  }

  async updateList(id: string, data: UpdateReadingListInput, userId?: string) {
    const list = await this.getListById(id);
    if (userId && list.userId !== userId) {
      throw new NotFoundError('ReadingList', id);
    }
    return this.repository.updateList(id, data);
  }

  async deleteList(id: string, userId?: string) {
    const list = await this.getListById(id);
    if (userId && list.userId !== userId) {
      throw new NotFoundError('ReadingList', id);
    }
    return this.repository.softDeleteList(id);
  }

  async addToList(listId: string, data: AddListItemInput) {
    await this.getListById(listId);
    return this.repository.insertListItem({
      listId,
      manhwaId: data.manhwaId,
      sortOrder: data.sortOrder,
    });
  }

  async removeFromList(listId: string, manhwaId: string) {
    await this.getListById(listId);
    return this.repository.deleteListItem(listId, manhwaId);
  }
}
