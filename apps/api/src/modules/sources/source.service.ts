import { NotFoundError } from '../../shared/lib/errors.js';
import type { SourceRepository } from './source.repository.js';
import type { Source } from './source.schema.js';
import type { CreateSourceInput, UpdateSourceInput } from './source.validator.js';

export class SourceService {
  constructor(private readonly repo: SourceRepository) {}

  async getAll(): Promise<Source[]> {
    return this.repo.findAll();
  }

  async getById(id: Source['id']): Promise<Source> {
    const source = await this.repo.findById(id);
    if (!source) throw new NotFoundError('Source', id);
    return source;
  }

  async create(data: CreateSourceInput, userId: string): Promise<Source> {
    return this.repo.insert({ ...data, createdBy: userId });
  }

  async update(id: Source['id'], data: UpdateSourceInput, userId: string): Promise<Source> {
    const updated = await this.repo.update(id, { ...data, updatedBy: userId });
    if (!updated) throw new NotFoundError('Source', id);
    return updated;
  }

  async delete(id: Source['id'], userId: string): Promise<void> {
    const deleted = await this.repo.softDelete(id, userId);
    if (!deleted) throw new NotFoundError('Source', id);
  }
}
