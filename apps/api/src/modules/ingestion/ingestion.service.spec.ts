import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import { ConflictError, NotFoundError } from '../../shared/lib/errors.js';
import type {
  IngestionRepository,
  ManhwaSourceLink,
  TeamInput,
  TrackedSeries,
  TrackedSeriesPageQuery,
  UpsertedRelease,
} from './ingestion.repository.js';
import type {
  IngestionBatch,
  NewChapterRelease,
  NewIngestionBatch,
  NewScrapeRun,
  ScrapeRun,
} from './ingestion.schema.js';
import { IngestionService, type IngestionRepositories } from './ingestion.service.js';
import type { FinishRunInput, IngestBatchInput } from './ingestion.validator.js';

/** Repository en mémoire : compte les écritures pour vérifier qu'un rejeu ne retraite rien. */
class InMemoryIngestionRepository implements IngestionRepository {
  readonly batches = new Map<string, IngestionBatch>();
  readonly sources = new Set<string>();
  readonly mappings = new Map<string, string>();
  readonly chapters = new Map<string, string>();
  readonly releases = new Set<string>();
  readonly runs = new Map<string, ScrapeRun>();
  writes = 0;

  async lockIdempotencyKey(): Promise<void> {}

  async findBatchByKey(key: string): Promise<IngestionBatch | null> {
    return this.batches.get(key) ?? null;
  }

  async insertBatch(data: NewIngestionBatch): Promise<IngestionBatch> {
    const batch: IngestionBatch = {
      id: randomUUID(),
      idempotencyKey: data.idempotencyKey,
      requestHash: data.requestHash,
      sourceId: data.sourceId,
      scrapeRunId: data.scrapeRunId ?? null,
      result: data.result,
      receivedAt: new Date(),
    };
    this.batches.set(batch.idempotencyKey, batch);
    return batch;
  }

  async sourceExists(sourceId: string): Promise<boolean> {
    return this.sources.has(sourceId);
  }

  async findManhwaIdBySourceUrl(sourceId: string, url: string): Promise<string | null> {
    return this.mappings.get(`${sourceId}|${url}`) ?? null;
  }

  async createManhwa(): Promise<string> {
    this.writes += 1;
    return randomUUID();
  }

  async enrichManhwa(): Promise<boolean> {
    this.writes += 1;
    return true;
  }

  async addCover(): Promise<boolean> {
    this.writes += 1;
    return true;
  }

  async upsertChapter(manhwaId: string, item: { number: number }): Promise<{ id: string; created: boolean }> {
    this.writes += 1;
    const key = `${manhwaId}|${item.number}`;
    const existing = this.chapters.get(key);
    if (existing) return { id: existing, created: false };
    const id = randomUUID();
    this.chapters.set(key, id);
    return { id, created: true };
  }

  readonly teamsByName = new Map<string, string>();
  readonly releaseTeams = new Map<string, readonly string[]>();

  async upsertTeam({ name }: TeamInput): Promise<string | null> {
    if (!name) return null;
    const id = this.teamsByName.get(name) ?? randomUUID();
    this.teamsByName.set(name, id);
    return id;
  }

  async setReleaseTeams(releaseId: string, teamIds: readonly string[]): Promise<void> {
    if (teamIds.length > 0) this.releaseTeams.set(releaseId, teamIds);
  }

  async upsertRelease(data: NewChapterRelease): Promise<UpsertedRelease> {
    this.writes += 1;
    const key = `${data.sourceId}|${data.url}`;
    const created = !this.releases.has(key);
    this.releases.add(key);
    return { id: key, created };
  }

  async linkManhwaSource({ sourceId, manhwaUrl, manhwaId }: ManhwaSourceLink): Promise<void> {
    this.mappings.set(`${sourceId}|${manhwaUrl}`, manhwaId);
  }

  async insertRun(data: NewScrapeRun): Promise<ScrapeRun> {
    const run: ScrapeRun = {
      id: randomUUID(),
      sourceId: data.sourceId,
      status: 'running',
      workerVersion: data.workerVersion ?? null,
      startedAt: new Date(),
      finishedAt: null,
      stats: null,
      error: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  async findRun(id: string): Promise<ScrapeRun | null> {
    return this.runs.get(id) ?? null;
  }

  async finishRun(id: string, data: FinishRunInput): Promise<ScrapeRun | null> {
    const run = this.runs.get(id);
    if (!run || run.status !== 'running') return null;
    const finished: ScrapeRun = {
      ...run,
      status: data.status,
      stats: data.stats ?? null,
      error: data.error ?? null,
      finishedAt: new Date(),
    };
    this.runs.set(id, finished);
    return finished;
  }

  async insertHealthSamples(samples: unknown[]): Promise<number> {
    return samples.length;
  }

  /** Œuvres suivies par source, déjà filtrées (le filtrage SQL est couvert par les tests de route). */
  readonly tracked = new Map<string, TrackedSeries[]>();

  async findTrackedSeries(sourceId: string, { cursor, limit }: TrackedSeriesPageQuery): Promise<TrackedSeries[]> {
    return (this.tracked.get(sourceId) ?? [])
      .filter((series) => cursor === undefined || series.manhwaId > cursor)
      .sort((a, b) => a.manhwaId.localeCompare(b.manhwaId))
      .slice(0, limit);
  }
}

describe('IngestionService', () => {
  const sourceId = randomUUID();
  let repo: InMemoryIngestionRepository;
  let service: IngestionService;

  // « Transaction » en mémoire : exécute le travail avec le même repository (savepoint sans retour arrière :
  // l'annulation réelle des écritures d'une fiche en échec est vérifiée par les tests d'intégration).
  const transactions: TransactionRunner<IngestionRepositories> = {
    run: (work) => work({ ingestion: repo }, (inner) => inner({ ingestion: repo })),
  };

  const batch = (chapterNumbers: number[]): IngestBatchInput => ({
    sourceId,
    manhwas: [
      {
        sourceManhwaUrl: 'https://asura.example/series/solo-leveling',
        title: 'Solo Leveling',
        chapters: chapterNumbers.map((number) => ({
          number,
          url: `https://asura.example/series/solo-leveling/${number}`,
          language: 'fr',
        })),
      },
    ],
  });

  beforeEach(() => {
    repo = new InMemoryIngestionRepository();
    repo.sources.add(sourceId);
    service = new IngestionService(repo, transactions);
  });

  describe('idempotency', () => {
    it('replays a known key without processing the batch again', async () => {
      const first = await service.ingestBatch('key-00000001', batch([1, 2]));
      const writesAfterFirst = repo.writes;

      const second = await service.ingestBatch('key-00000001', batch([1, 2]));

      expect(first.replayed).toBe(false);
      expect(second).toEqual({ replayed: true, result: first.result });
      expect(repo.writes).toBe(writesAfterFirst);
    });

    it('rejects a known key reused with a different payload', async () => {
      await service.ingestBatch('key-00000002', batch([1]));

      await expect(service.ingestBatch('key-00000002', batch([1, 2]))).rejects.toBeInstanceOf(ConflictError);
    });

    it('does not consume the key when the batch fails', async () => {
      const unknownSource = { ...batch([1]), sourceId: randomUUID() };

      await expect(service.ingestBatch('key-00000003', unknownSource)).rejects.toBeInstanceOf(NotFoundError);
      expect(repo.batches.has('key-00000003')).toBe(false);
    });

    it('converges when a new key re-sends already ingested data (natural keys)', async () => {
      await service.ingestBatch('key-00000004', batch([1, 2]));

      const { result } = await service.ingestBatch('key-00000005', batch([1, 2, 3]));

      expect(result).toMatchObject({ chaptersCreated: 1, releasesCreated: 1, releasesUpdated: 2 });
      expect(result.manhwas[0]?.created).toBe(false);
    });
  });

  describe('partial batch success', () => {
    const otherUrl = 'https://asura.example/series/eleceed';
    const twoSeries = (): IngestBatchInput => {
      const solo = batch([1, 2]).manhwas[0];
      if (!solo) throw new Error('lot de test vide');
      return {
        sourceId,
        manhwas: [
          { ...solo, manhwaId: randomUUID() }, // URL déjà rattachée à une autre œuvre → conflit
          { sourceManhwaUrl: otherUrl, title: 'Eleceed', chapters: [{ number: 1, url: `${otherUrl}/1`, language: 'fr' }] },
        ],
      };
    };

    beforeEach(() => {
      repo.mappings.set(`${sourceId}|https://asura.example/series/solo-leveling`, randomUUID());
    });

    it('skips a conflicting series, keeps the others and reports the refused one', async () => {
      const { result } = await service.ingestBatch('key-partial-1', twoSeries());

      expect(result.failed).toEqual([
        {
          sourceManhwaUrl: 'https://asura.example/series/solo-leveling',
          code: 'CONFLICT',
          message: 'https://asura.example/series/solo-leveling is already mapped to another manhwa',
        },
      ]);
      expect(result.manhwas.map((m) => m.sourceManhwaUrl)).toEqual([otherUrl]);
      // Les compteurs ne reflètent que les fiches enregistrées.
      expect(result).toMatchObject({ chaptersCreated: 1, releasesCreated: 1, releasesUpdated: 0 });
      expect(repo.batches.get('key-partial-1')?.result).toEqual(result);
    });

    it('still fails the whole batch on an unexpected error (the key stays reusable)', async () => {
      repo.upsertChapter = async () => {
        throw new Error('connexion perdue');
      };

      await expect(service.ingestBatch('key-partial-2', batch([1]))).rejects.toThrow('connexion perdue');
      expect(repo.batches.has('key-partial-2')).toBe(false);
    });
  });

  describe('scrape runs', () => {
    it('finishes a running run once, then answers Conflict', async () => {
      const run = await service.startRun({ sourceId });

      await expect(service.finishRun(run.id, { status: 'succeeded' })).resolves.toMatchObject({ status: 'succeeded' });
      await expect(service.finishRun(run.id, { status: 'failed' })).rejects.toBeInstanceOf(ConflictError);
      await expect(service.finishRun(randomUUID(), { status: 'failed' })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('listTrackedSeries', () => {
    const series = (manhwaId: string): TrackedSeries => ({
      manhwaId,
      title: `Série ${manhwaId.slice(0, 4)}`,
      manhwaUrl: null,
      latestChapter: null,
      lastScrapedAt: null,
    });
    const ids = ['10000000-0000-4000-8000-000000000000', '20000000-0000-4000-8000-000000000000', '30000000-0000-4000-8000-000000000000'];

    beforeEach(() => {
      repo.tracked.set(sourceId, ids.map(series));
    });

    it('rejects an unknown source', async () => {
      await expect(service.listTrackedSeries({ sourceId: randomUUID(), limit: 10 })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns everything with no cursor when the page is not full', async () => {
      const page = await service.listTrackedSeries({ sourceId, limit: 10 });

      expect(page.data.map((s) => s.manhwaId)).toEqual(ids);
      expect(page.nextCursor).toBeNull();
    });

    it('returns no cursor when the last page is exactly full', async () => {
      const page = await service.listTrackedSeries({ sourceId, limit: 3 });

      expect(page.data).toHaveLength(3);
      expect(page.nextCursor).toBeNull();
    });

    it('pages through the series with the cursor, without gaps or duplicates', async () => {
      const first = await service.listTrackedSeries({ sourceId, limit: 2 });
      expect(first.data.map((s) => s.manhwaId)).toEqual(ids.slice(0, 2));
      expect(first.nextCursor).toBe(ids[1]);

      const second = await service.listTrackedSeries({ sourceId, limit: 2, cursor: first.nextCursor ?? undefined });
      expect(second.data.map((s) => s.manhwaId)).toEqual(ids.slice(2));
      expect(second.nextCursor).toBeNull();
    });
  });
});
