import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../shared/lib/errors.js';
import type { ChapterRepository } from './chapter.repository.js';
import type { Chapter, ChapterWithReleases, NewChapter } from './chapter.schema.js';
import { ChapterService } from './chapter.service.js';

/** Repository en mémoire : reproduit le contrat du repository Drizzle (soft delete, tri, parutions). */
class InMemoryChapterRepository implements ChapterRepository {
  readonly rows = new Map<string, Chapter>();
  readonly releases = new Map<string, ChapterWithReleases['releases']>();

  private active(): Chapter[] {
    return [...this.rows.values()].filter((row) => row.deletedAt === null);
  }

  async findAll(): Promise<Chapter[]> {
    return this.active();
  }

  async findByManhwaId(manhwaId: string): Promise<ChapterWithReleases[]> {
    return this.active()
      .filter((row) => row.manhwaId === manhwaId)
      .sort((a, b) => a.number - b.number)
      .map((row) => ({ ...row, releases: this.releases.get(row.id) ?? [] }));
  }

  async findById(id: string): Promise<Chapter | null> {
    const row = this.rows.get(id);
    return row && row.deletedAt === null ? row : null;
  }

  async insert(data: NewChapter): Promise<Chapter> {
    const now = new Date();
    const row: Chapter = {
      id: randomUUID(),
      manhwaId: data.manhwaId,
      number: data.number,
      kind: data.kind ?? 'regular',
      title: data.title ?? null,
      releaseDate: data.releaseDate ?? null,
      createdAt: now,
      updatedAt: now,
      createdBy: data.createdBy ?? null,
      updatedBy: data.updatedBy ?? null,
      deletedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(id: string, data: Partial<NewChapter>): Promise<Chapter | null> {
    const row = await this.findById(id);
    if (!row) return null;
    const updated: Chapter = { ...row, ...data, id: row.id, updatedAt: new Date() };
    this.rows.set(id, updated);
    return updated;
  }

  async softDelete(id: string, deletedBy: string | null): Promise<Chapter | null> {
    return this.update(id, { deletedAt: new Date(), updatedBy: deletedBy });
  }
}

describe('ChapterService', () => {
  const manhwaId = randomUUID();
  let repo: InMemoryChapterRepository;
  let service: ChapterService;

  beforeEach(() => {
    repo = new InMemoryChapterRepository();
    service = new ChapterService(repo);
  });

  it('lists a manhwa chapters in order with their releases, deleted ones excluded', async () => {
    const second = await service.create({ manhwaId, number: 2 }, 'admin');
    const first = await service.create({ manhwaId, number: 1 }, 'admin');
    const deleted = await service.create({ manhwaId, number: 3 }, 'admin');
    await service.delete(deleted.id, 'admin');
    const team = { id: randomUUID(), name: 'Asura Scans', websiteUrl: null };
    repo.releases.set(second.id, [
      { id: randomUUID(), url: 'https://asura.example/2', language: 'fr', sourceName: 'Asura Scans', teams: [team] },
    ]);

    const result = await service.getByManhwaId(manhwaId);

    expect(result.map((chapter) => chapter.id)).toEqual([first.id, second.id]);
    expect(result[0]?.releases).toEqual([]);
    expect(result[1]?.releases[0]?.teams).toEqual([team]);
  });

  it('throws NotFoundError for an unknown or deleted chapter', async () => {
    const chapter = await service.create({ manhwaId, number: 1 }, 'admin');
    await service.delete(chapter.id, 'admin');

    await expect(service.getById(chapter.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.update(chapter.id, { title: 'x' }, 'admin')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.delete(chapter.id, 'admin')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('traces the author of creations and updates', async () => {
    const chapter = await service.create({ manhwaId, number: 1 }, 'creator');
    const updated = await service.update(chapter.id, { title: 'Prologue' }, 'editor');

    expect(chapter.createdBy).toBe('creator');
    expect(updated).toMatchObject({ title: 'Prologue', updatedBy: 'editor' });
  });
});
