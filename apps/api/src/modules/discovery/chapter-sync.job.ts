import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { externalLinks, manhwas, sources } from '../../shared/db/schema.js';
import type { TransactionRunner } from '../../shared/db/transaction.js';
import { firstOrNull } from '../../shared/db/utils.js';
import { NotFoundError } from '../../shared/lib/errors.js';
import type { IngestionRepository } from '../ingestion/ingestion.repository.js';
import type { JobHandler, JobPayloads } from '../jobs/job.types.js';
import {
  isExternalProvider,
  type ExternalChapterFeed,
  type ExternalProvider,
  type ExternalRef,
  type ExternalSource,
} from './external-catalog.js';

/** Auteur technique des lignes créées par les tâches de fond (colonnes d'audit). */
export const JOBS_ACTOR = 'system:jobs';

export interface ChapterSyncRepository {
  isManhwaActive(manhwaId: string): Promise<boolean>;
  /** Références externes de l'œuvre (`external_links`), limitées aux fournisseurs connus du code. */
  findExternalRefs(manhwaId: string): Promise<Pick<ExternalRef, 'provider' | 'externalId'>[]>;
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

  async findExternalRefs(manhwaId: string): Promise<Pick<ExternalRef, 'provider' | 'externalId'>[]> {
    const rows = await this.db
      .select({ provider: externalLinks.provider, externalId: externalLinks.externalId })
      .from(externalLinks)
      .where(eq(externalLinks.manhwaId, manhwaId));
    // `provider` est un texte libre en base : on écarte ce que le code ne connaît pas (ex. 'mal').
    return rows.flatMap(({ provider, externalId }) => (isExternalProvider(provider) ? [{ provider, externalId }] : []));
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

export type ChapterSyncLogger = Pick<Console, 'info' | 'warn'>;

type SyncTarget = { feed: ExternalChapterFeed; externalId: string };

/**
 * Tâche `chapters.sync`, agnostique du fournisseur : elle ne reçoit que l'œuvre, lit ses liens
 * externes (`external_links`) et délègue à CHAQUE fournisseur lié qui sait lister des chapitres
 * (port `ExternalChapterFeed`). Aucun fournisseur n'est privilégié ni codé en dur.
 *
 * - Aucun lien vers un fournisseur à chapitres : la tâche se termine sans erreur. Les chapitres
 *   arriveront par l'ingestion du scraper (`/api/ingest`), ou d'un flux lié plus tard.
 * - Plusieurs flux : chacun alimente sa propre source ; l'échec de l'un n'empêche pas les autres.
 * - Rejouable sans doublon (upserts idempotents), l'appel réseau précède chaque transaction.
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

  async handle({ manhwaId }: JobPayloads['chapters.sync']): Promise<void> {
    // Retirée du catalogue entre la mise en file et l'exécution : plus rien à synchroniser.
    if (!(await this.repo.isManhwaActive(manhwaId))) return;

    const targets = (await this.repo.findExternalRefs(manhwaId)).flatMap(({ provider, externalId }): SyncTarget[] => {
      const feed = this.feeds.get(provider);
      return feed ? [{ feed, externalId }] : [];
    });
    if (targets.length === 0) {
      this.logger.info(`[JOBS] chapters.sync ${manhwaId}: no linked chapter feed, waiting for the scraper`);
      return;
    }

    const failures: { provider: ExternalProvider; error: unknown }[] = [];
    for (const target of targets) {
      try {
        await this.syncFrom(manhwaId, target);
      } catch (error) {
        // L'œuvre n'existe plus chez ce fournisseur : ré-essayer ne changera rien, on passe au suivant.
        if (error instanceof NotFoundError) {
          this.logger.warn(`[JOBS] chapters.sync ${target.feed.name}:${target.externalId} skipped: ${error.message}`);
          continue;
        }
        failures.push({ provider: target.feed.name, error });
      }
    }

    // Échec transitoire (réseau, quota…) : la tâche entière est rejouée plus tard. Les flux déjà
    // synchronisés le seront à nouveau sans effet (upserts idempotents).
    // Le détail de chaque fournisseur reste lisible dans `jobs.last_error` (diagnostic sans fouiller les logs).
    if (failures.length > 0) {
      const details = failures
        .map(({ provider, error }) => `${provider}: ${error instanceof Error ? error.message : String(error)}`)
        .join('; ');
      throw new Error(`${failures.length}/${targets.length} chapter feed(s) failed — ${details}`, {
        cause: failures[0]?.error,
      });
    }
  }

  private async syncFrom(manhwaId: string, { feed, externalId }: SyncTarget): Promise<void> {
    const chapters = await feed.listChapters(externalId);

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
      `[JOBS] chapters.sync ${feed.name}:${externalId} → ${stats.chapters} chapters ` +
        `(${stats.chaptersCreated} new, ${stats.releasesCreated} new releases)`,
    );
  }
}
