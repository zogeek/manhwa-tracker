import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../shared/lib/errors.js';
import type { SourceRepository } from './source.repository.js';
import type { NewSource, Source } from './source.schema.js';
import { SourceService } from './source.service.js';

/** Repository en mémoire : reproduit le contrat du repository Drizzle (soft delete inclus). */
class InMemorySourceRepository implements SourceRepository {
  readonly rows = new Map<string, Source>();

  async findAll(): Promise<Source[]> {
    return [...this.rows.values()].filter((row) => row.deletedAt === null);
  }

  async findById(id: string): Promise<Source | null> {
    const row = this.rows.get(id);
    return row && row.deletedAt === null ? row : null;
  }

  async insert(data: NewSource): Promise<Source> {
    const now = new Date();
    const row: Source = {
      id: randomUUID(),
      name: data.name,
      baseUrl: data.baseUrl,
      language: data.language ?? 'fr',
      iconUrl: data.iconUrl ?? null,
      isOfficial: data.isOfficial ?? false,
      createdAt: now,
      updatedAt: now,
      createdBy: data.createdBy ?? null,
      updatedBy: data.updatedBy ?? null,
      deletedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(id: string, data: Partial<NewSource>): Promise<Source | null> {
    const row = await this.findById(id);
    if (!row) return null;
    const updated: Source = { ...row, ...data, id: row.id, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async softDelete(id: string, deletedBy: string | null): Promise<Source | null> {
    return this.update(id, { deletedAt: new Date(), updatedBy: deletedBy });
  }
}

describe('SourceService', () => {
  let repo: InMemorySourceRepository;
  let service: SourceService;

  beforeEach(() => {
    repo = new InMemorySourceRepository();
    service = new SourceService(repo);
  });

  it('records the author on create', async () => {
    const source = await service.create({ name: 'Asura', baseUrl: 'https://asura.example' }, 'user-1');

    expect(source.createdBy).toBe('user-1');
    expect(await service.getById(source.id)).toEqual(source);
  });

  it('throws NotFoundError for an unknown id', async () => {
    await expect(service.getById(randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('soft deletes: the source disappears from reads and cannot be deleted twice', async () => {
    const source = await service.create({ name: 'Asura', baseUrl: 'https://asura.example' }, 'user-1');

    await service.delete(source.id, 'user-2');

    expect(repo.rows.get(source.id)?.updatedBy).toBe('user-2');
    expect(await service.getAll()).toEqual([]);
    await expect(service.getById(source.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.delete(source.id, 'user-2')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when updating a missing source', async () => {
    await expect(service.update(randomUUID(), { name: 'x' }, 'user-1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
