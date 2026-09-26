import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { manhwas, sources } from '../../shared/db/schema.js';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import { firstOrNull } from '../../shared/db/utils.js';
import { NotFoundError } from '../../shared/lib/errors.js';
import type { IngestionRepository } from '../ingestion/ingestion.repository.js';
import { PermanentJobError, type JobHandler, type JobPayloads } from '../jobs/job.types.js';
import type { ExternalChapterFeed, ExternalProvider, ExternalSource } from './external-catalog.js';

/** Auteur technique des lignes créées par les tâches de fond (colonnes d'audit). */
export const JOBS_ACTOR = 'system:jobs';

export interface ChapterSyncRepository {
  isManhwaActive(manhwaId: string): Promise<boolean>;
  /** Id de la source active correspondant au fournisseur (créée au premier passage). */
  ensureSource(source: ExternalSource): Promise<string>;
}

export type ChapterSyncRepositories = {
  sync: ChapterSyncRepository;
  // Réutilise les upserts idempotents de l'ingestion : une seule façon d'écrire un chapitre.
  ingestion: Pick<IngestionRepository, 'upsertChapter' | 'upsertScanlationGroup' | 'upsertRelease' | 'linkManhwaSource'>;
};

export class DrizzleChapterSyncRepository implements ChapterSyncRepository {
  constructor(private readonly db: DbClient) {}

  async isManhwaActive(manhwaId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: manhwas.id })
      .from(manhwas)
      .where(and(eq(manhwas.id, manhwaId), isNull(manhwas.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async ensureSource({ name, baseUrl, language }: ExternalSource): Promise<string> {
    const existing = await this.findActiveSource(baseUrl);
    if (existing) return existing;

    const inserted = await this.db
      .insert(sources)
      .values({ name, baseUrl, language, createdBy: JOBS_ACTOR })
      // Cible = l'index unique partiel des sources actives (le prédicat doit être répété).
      .onConflictDoNothing({ target: sources.baseUrl, where: isNull(sources.deletedAt) })
      .returning({ id: sources.id });
    const created = firstOrNull(inserted);
    if (created) return created.id;

    // Créée par une synchronisation concurrente entre notre lecture et notre insertion.
    const concurrent = await this.findActiveSource(baseUrl);
    if (!concurrent) throw new Error(`Source ${baseUrl} could not be created`);
    return concurrent;
  }

  private async findActiveSource(baseUrl: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.baseUrl, baseUrl), isNull(sources.deletedAt)))
      .limit(1);
    return firstOrNull(rows)?.id ?? null;
  }
}

export type ChapterSyncStats = { chapters: number; chaptersCreated: number; releasesCreated: number };

export type ChapterSyncLogger = Pick<Console, 'info'>;

/**
 * Tâche `chapters.sync` : lit le flux de chapitres d'un fournisseur et l'upserte en base
 * (chapitres canoniques + parutions par langue/équipe). Rejouable sans doublon.
 * L'appel réseau précède la transaction : pas de connexion Postgres tenue pendant la pagination.
 */
export class ChapterSyncJob implements JobHandler<'chapters.sync'> {
  readonly type: 'chapters.sync' = 'chapters.sync';
  private readonly feeds: ReadonlyMap<ExternalProvider, ExternalChapterFeed>;

  constructor(
    feeds: readonly ExternalChapterFeed[],
    private readonly repo: ChapterSyncRepository,
    private readonly transactions: TransactionRunner<ChapterSyncRepositories>,
    private readonly logger: ChapterSyncLogger = console,
  ) {
    this.feeds = new Map(feeds.map((feed) => [feed.name, feed]));
  }

  async handle({ manhwaId, provider, externalId }: JobPayloads['chapters.sync']): Promise<void> {
    const feed = this.feeds.get(provider);
    if (!feed) throw new PermanentJobError(`No chapter feed enabled for ${provider}`);
    // Retirée du catalogue entre la mise en file et l'exécution : plus rien à synchroniser.
    if (!(await this.repo.isManhwaActive(manhwaId))) return;

    const chapters = await feed.listChapters(externalId).catch((error: unknown) => {
      if (error instanceof NotFoundError) throw new PermanentJobError(error.message, { cause: error });
      throw error;
    });

    const stats = await this.transactions.run(async ({ sync, ingestion }): Promise<ChapterSyncStats> => {
      const sourceId = await sync.ensureSource(feed.source);
      const groupIds = new Map<string, string>();
      const chapterNumbers = new Set<number>();
      let chaptersCreated = 0;
      let releasesCreated = 0;

      for (const chapter of chapters) {
        const { id: chapterId, created } = await ingestion.upsertChapter(manhwaId, {
          number: chapter.number,
          title: chapter.title,
          kind: 'regular',
          url: chapter.url,
          language: chapter.language,
          publishedAt: chapter.publishedAt,
        });
        chapterNumbers.add(chapter.number);
        if (created) chaptersCreated += 1;

        let scanlationGroupId: string | null = null;
        if (chapter.scanlationGroup) {
          scanlationGroupId = groupIds.get(chapter.scanlationGroup) ?? (await ingestion.upsertScanlationGroup(chapter.scanlationGroup));
          groupIds.set(chapter.scanlationGroup, scanlationGroupId);
        }

        const releaseCreated = await ingestion.upsertRelease({
          chapterId,
          sourceId,
          scanlationGroupId,
          url: chapter.url,
          language: chapter.language,
          publishedAt: chapter.publishedAt,
        });
        if (releaseCreated) releasesCreated += 1;
      }

      await ingestion.linkManhwaSource({
        manhwaId,
        sourceId,
        manhwaUrl: feed.workUrl(externalId),
        latestChapter: chapterNumbers.size > 0 ? Math.max(...chapterNumbers) : null,
      });
      return { chapters: chapterNumbers.size, chaptersCreated, releasesCreated };
    });

    this.logger.info(
      `[JOBS] chapters.sync ${provider}:${externalId} → ${stats.chapters} chapters ` +
        `(${stats.chaptersCreated} new, ${stats.releasesCreated} new releases)`,
    );
  }
}
