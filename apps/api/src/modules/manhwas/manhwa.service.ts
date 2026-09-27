import { NotFoundError } from '../../shared/lib/errors.js';
import type { ManhwaRepository } from './manhwa.repository.js';
import type { Manhwa, ManhwaView } from './manhwa.schema.js';
import type { CreateManhwaInput, UpdateManhwaInput } from './manhwa.validator.js';

export class ManhwaService {
  constructor(private readonly repo: ManhwaRepository) {}

  async getAll(): Promise<ManhwaView[]> {
    return this.repo.findAll();
  }

  async getById(id: Manhwa['id']): Promise<ManhwaView> {
    const manhwa = await this.repo.findById(id);
    if (!manhwa) throw new NotFoundError('Manhwa', id);
    return manhwa;
  }

  async create(data: CreateManhwaInput, userId: string): Promise<Manhwa> {
    return this.repo.insert({ ...data, createdBy: userId });
  }

  async update(id: Manhwa['id'], data: UpdateManhwaInput, userId: string): Promise<Manhwa> {
    const updated = await this.repo.update(id, { ...data, updatedBy: userId });
    if (!updated) throw new NotFoundError('Manhwa', id);
    return updated;
  }

  async delete(id: Manhwa['id'], userId: string): Promise<void> {
    const deleted = await this.repo.softDelete(id, userId);
    if (!deleted) throw new NotFoundError('Manhwa', id);
  }
}
