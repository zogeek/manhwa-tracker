import { createHash } from 'node:crypto';
import { mapDatabaseError } from '../../shared/db/errors.js';
import type { Savepoint, TransactionRunner } from '../../shared/db/transaction.js';
import { AppError, ConflictError, NotFoundError, UnprocessableEntityError } from '../../shared/lib/errors.js';
import type { IngestionRepository, TrackedSeries } from './ingestion.repository.js';
import type { IngestionBatchResult, ScrapeRun } from './ingestion.schema.js';
import type {
  FinishRunInput,
  IngestBatchInput,
  IngestManhwaItem,
  RecordHealthInput,
  StartRunInput,
  TrackedSeriesQuery,
} from './ingestion.validator.js';

export type IngestionRepositories = { ingestion: IngestionRepository };

type FailedItem = NonNullable<IngestionBatchResult['failed']>[number];

export type TrackedSeriesPage = { data: TrackedSeries[]; nextCursor: string | null };

export type BatchOutcome = {
  /** `true` : la clé avait déjà été traitée, le résultat d'origine est renvoyé tel quel. */
  replayed: boolean;
  result: IngestionBatchResult;
};

/** Empreinte du lot validé : détecte une même clé réutilisée pour un contenu différent. */
export function hashBatch(batch: IngestBatchInput): string {
  return createHash('sha256').update(JSON.stringify(batch)).digest('hex');
}

/**
 * Erreur propre à une fiche (conflit d'URL, donnée refusée par une contrainte) : la rejouer donnerait le même
 * résultat, on peut donc l'écarter sans perdre le reste du lot. Toute autre erreur (base injoignable, bug)
 * reste fatale : le lot entier est annulé et la clé reste libre pour un nouvel essai.
 */
function itemError(error: unknown): AppError | undefined {
  const appError = error instanceof AppError ? error : mapDatabaseError(error);
  return appError && appError.status >= 400 && appError.status < 500 ? appError : undefined;
}

/**
 * Point d'entrée du worker de scraping. Chaque lot est :
 * - idempotent : rejouer la même `Idempotency-Key` ne retraite rien ;
 * - tolérant par fiche : chaque œuvre s'écrit dans son propre SAVEPOINT ; une fiche refusée (`itemError`)
 *   est annulée seule et listée dans `failed`, les autres sont enregistrées ;
 * - atomique pour le reste : une erreur fatale annule tout le lot (la clé reste libre) ;
 * - non destructif : il complète les fiches sans écraser les corrections des admins.
 */
export class IngestionService {
  constructor(
    private readonly repo: IngestionRepository,
    private readonly transactions: TransactionRunner<IngestionRepositories>,
  ) {}

  async ingestBatch(idempotencyKey: string, batch: IngestBatchInput): Promise<BatchOutcome> {
    const requestHash = hashBatch(batch);

    return this.transactions.run(async ({ ingestion }, savepoint) => {
      await ingestion.lockIdempotencyKey(idempotencyKey);

      const existing = await ingestion.findBatchByKey(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictError('Idempotency-Key already used with a different payload');
        }
        return { replayed: true, result: existing.result };
      }

      if (!(await ingestion.sourceExists(batch.sourceId))) {
        throw new NotFoundError('Source', batch.sourceId);
      }

      const failed: FailedItem[] = [];
      const result: IngestionBatchResult = {
        manhwas: [],
        chaptersCreated: 0,
        releasesCreated: 0,
        releasesUpdated: 0,
        coversAdded: 0,
        failed,
      };

      for (const item of batch.manhwas) {
        await this.ingestIsolated(savepoint, batch.sourceId, item, result, failed);
      }

      await ingestion.insertBatch({
        idempotencyKey,
        requestHash,
        sourceId: batch.sourceId,
        scrapeRunId: batch.scrapeRunId ?? null,
        result,
      });
      return { replayed: false, result };
    });
  }

  async startRun(data: StartRunInput): Promise<ScrapeRun> {
    return this.repo.insertRun(data);
  }

  async finishRun(id: string, data: FinishRunInput): Promise<ScrapeRun> {
    const finished = await this.repo.finishRun(id, data);
    if (finished) return finished;

    const run = await this.repo.findRun(id);
    if (!run) throw new NotFoundError('ScrapeRun', id);
    throw new ConflictError(`Scrape run is already ${run.status}`);
  }

  async recordHealth({ samples }: RecordHealthInput): Promise<number> {
    return this.repo.insertHealthSamples(samples);
  }

  /** Œuvres suivies par au moins un lecteur, liées ou non à la source : la liste de travail du worker. */
  async listTrackedSeries({ sourceId, cursor, limit }: TrackedSeriesQuery): Promise<TrackedSeriesPage> {
    if (!(await this.repo.sourceExists(sourceId))) {
      throw new NotFoundError('Source', sourceId);
    }
    // Une ligne de plus que demandé : sa présence prouve qu'une page suivante existe.
    const rows = await this.repo.findTrackedSeries(sourceId, { cursor, limit: limit + 1 });
    const data = rows.slice(0, limit);
    const last = data.at(-1);
    return { data, nextCursor: rows.length > limit && last ? last.manhwaId : null };
  }

  /** Une fiche dans son SAVEPOINT : en cas de refus, ses écritures et ses compteurs sont annulés ensemble. */
  private async ingestIsolated(
    savepoint: Savepoint<IngestionRepositories>,
    sourceId: string,
    item: IngestManhwaItem,
    result: IngestionBatchResult,
    failed: FailedItem[],
  ): Promise<void> {
    const itemResult: IngestionBatchResult = {
      manhwas: [],
      chaptersCreated: 0,
      releasesCreated: 0,
      releasesUpdated: 0,
      coversAdded: 0,
    };
    try {
      await savepoint(({ ingestion }) => this.ingestManhwa(ingestion, sourceId, item, itemResult));
    } catch (error) {
      const refused = itemError(error);
      if (!refused) throw error;
      failed.push({ sourceManhwaUrl: item.sourceManhwaUrl, code: refused.code, message: refused.message });
      return;
    }
    result.manhwas.push(...itemResult.manhwas);
    result.chaptersCreated += itemResult.chaptersCreated;
    result.releasesCreated += itemResult.releasesCreated;
    result.releasesUpdated += itemResult.releasesUpdated;
    result.coversAdded += itemResult.coversAdded;
  }

  private async ingestManhwa(
    ingestion: IngestionRepository,
    sourceId: string,
    item: IngestManhwaItem,
    result: IngestionBatchResult,
  ): Promise<void> {
    // 1. Rapprochement : URL déjà connue sur cette source > rattachement explicite > nouvelle fiche.
    const mappedId = await ingestion.findManhwaIdBySourceUrl(sourceId, item.sourceManhwaUrl);
    if (mappedId && item.manhwaId && mappedId !== item.manhwaId) {
      throw new ConflictError(`${item.sourceManhwaUrl} is already mapped to another manhwa`);
    }

    let manhwaId = mappedId ?? item.manhwaId;
    let created = false;
    if (!manhwaId) {
      manhwaId = await ingestion.createManhwa(item);
      created = true;
    } else if (!(await ingestion.enrichManhwa(manhwaId, item))) {
      throw new UnprocessableEntityError(`Manhwa ${manhwaId} does not exist`);
    }

    // 2. Couverture (galerie) — sans doublon.
    if (item.coverUrl && (await ingestion.addCover(manhwaId, item.coverUrl))) {
      result.coversAdded += 1;
    }

    // 3. Chapitres canoniques + parutions concrètes sur cette source.
    let latestChapter: number | null = null;
    for (const chapterItem of item.chapters) {
      const chapter = await ingestion.upsertChapter(manhwaId, chapterItem);
      if (chapter.created) result.chaptersCreated += 1;

      const release = await ingestion.upsertRelease({
        chapterId: chapter.id,
        sourceId,
        url: chapterItem.url,
        language: chapterItem.language,
        quality: chapterItem.quality,
        publishedAt: chapterItem.publishedAt ?? null,
      });
      if (release.created) result.releasesCreated += 1;
      else result.releasesUpdated += 1;

      // Teams créditées (le scraper ne connaît que leur nom : rapprochement par nom normalisé).
      const teamNames = [...(chapterItem.scanlationGroups ?? []), ...(chapterItem.scanlationGroup ? [chapterItem.scanlationGroup] : [])];
      const teamIds: string[] = [];
      for (const name of teamNames) {
        const id = await ingestion.upsertTeam({ name, websiteUrl: null, provider: null, externalId: null });
        if (id) teamIds.push(id);
      }
      await ingestion.setReleaseTeams(release.id, teamIds);

      latestChapter = Math.max(latestChapter ?? 0, chapterItem.number);
    }

    // 4. Lien œuvre ↔ source (URL, dernier chapitre dispo, date du dernier passage).
    await ingestion.linkManhwaSource({ manhwaId, sourceId, manhwaUrl: item.sourceManhwaUrl, latestChapter });

    result.manhwas.push({ sourceManhwaUrl: item.sourceManhwaUrl, manhwaId, created });
  }
}
