import { NotFoundError } from '../../shared/lib/errors.js';
import type { ChapterRepository } from './chapter.repository.js';
import type { Chapter } from './chapter.schema.js';
import type { CreateChapterInput, UpdateChapterInput } from './chapter.validator.js';

export class ChapterService {
  constructor(private readonly repo: ChapterRepository) {}

  async getAll(): Promise<Chapter[]> {
    return this.repo.findAll();
  }

  async getByManhwaId(manhwaId: Chapter['manhwaId']): Promise<Chapter[]> {
    return this.repo.findByManhwaId(manhwaId);
  }

  async getById(id: Chapter['id']): Promise<Chapter> {
    const chapter = await this.repo.findById(id);
    if (!chapter) throw new NotFoundError('Chapter', id);
    return chapter;
  }

  async create(data: CreateChapterInput, userId: string): Promise<Chapter> {
    return this.repo.insert({ ...data, createdBy: userId });
  }

  async update(id: Chapter['id'], data: UpdateChapterInput, userId: string): Promise<Chapter> {
    const updated = await this.repo.update(id, { ...data, updatedBy: userId });
    if (!updated) throw new NotFoundError('Chapter', id);
    return updated;
  }

  async delete(id: Chapter['id'], userId: string): Promise<void> {
    const deleted = await this.repo.softDelete(id, userId);
    if (!deleted) throw new NotFoundError('Chapter', id);
  }
}
