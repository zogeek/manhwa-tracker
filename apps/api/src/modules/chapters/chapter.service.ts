import { AppError, NotFoundError } from '../../shared/lib/errors.js';
import { ChapterRepository } from './chapter.repository.js';
import type { CreateChapterInput, UpdateChapterInput } from './chapter.validator.js';

export class ChapterService {
  constructor(private readonly repository = new ChapterRepository()) {}

  async getAll() {
    return await this.repository.findAll();
  }

  async getByManhwaId(manhwaId: string) {
    return await this.repository.findByManhwaId(manhwaId);
  }

  async getById(id: string) {
    const chapter = await this.repository.findById(id);
    if (!chapter) {
      throw new NotFoundError('Chapter', id);
    }
    return chapter;
  }

  async create(data: CreateChapterInput, userId?: string) {
    return await this.repository.insert({
      ...data,
      createdBy: userId,
    });
  }

  async update(id: string, data: UpdateChapterInput, userId?: string) {
    await this.getById(id);
    return await this.repository.update(id, data);
  }

  async delete(id: string, userId?: string) {
    await this.getById(id);
    await this.repository.softDelete(id);
  }
}
