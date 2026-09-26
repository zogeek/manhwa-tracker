import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import {
  chapters,
  manhwaCovers,
  manhwaSources,
  manhwas,
  scanlationGroups,
  sources,
} from '../../shared/db/schema.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { slugify } from '../../shared/lib/slug.js';
import {
  chapterReleases,
  ingestionBatches,
  scrapeRuns,
  sourceHealth,
  SCRAPER_ACTOR,
  type IngestionBatch,
  type NewChapterRelease,
  type NewIngestionBatch,
  type NewScrapeRun,
  type NewSourceHealth,
  type ScrapeRun,
} from './ingestion.schema.js';
import type { FinishRunInput, IngestChapterItem, IngestManhwaItem } from './ingestion.validator.js';

export type ManhwaEnrichment = Pick<
  IngestManhwaItem,
  'originalTitle' | 'synopsis' | 'coverUrl' | 'status' | 'totalChapters'
>;

export type ManhwaSourceLink = {
  manhwaId: string;
  sourceId: string;
  manhwaUrl: string;
  latestChapter: number | null;
};

export interface IngestionRepository {
  /** Sérialise les requêtes portant la même clé d'idempotence (verrou libéré au COMMIT/ROLLBACK). */
  lockIdempotencyKey(key: string): Promise<void>;
  findBatchByKey(key: string): Promise<IngestionBatch | null>;
  insertBatch(data: NewIngestionBatch): Promise<IngestionBatch>;
  sourceExists(sourceId: string): Promise<boolean>;
  findManhwaIdBySourceUrl(sourceId: string, manhwaUrl: string): Promise<string | null>;
  createManhwa(item: IngestManhwaItem): Promise<string>;
  /** Complète la fiche sans écraser les données saisies à la main. `false` si la fiche n'existe pas. */
  enrichManhwa(manhwaId: string, data: ManhwaEnrichment): Promise<boolean>;
  /** `true` si la couverture était nouvelle. */
  addCover(manhwaId: string, imageUrl: string): Promise<boolean>;
  upsertChapter(manhwaId: string, item: IngestChapterItem): Promise<{ id: string; created: boolean }>;
  upsertScanlationGroup(name: string): Promise<string>;
  /** `true` si la parution a été créée, `false` si elle existait déjà (rafraîchie). */
  upsertRelease(data: NewChapterRelease): Promise<boolean>;
  linkManhwaSource(link: ManhwaSourceLink): Promise<void>;
  insertRun(data: NewScrapeRun): Promise<ScrapeRun>;
  findRun(id: string): Promise<ScrapeRun | null>;
  finishRun(id: string, data: FinishRunInput): Promise<ScrapeRun | null>;
  insertHealthSamples(samples: NewSourceHealth[]): Promise<number>;
}

export class DrizzleIngestionRepository implements IngestionRepository {
  constructor(private readonly db: DbClient) {}

  async lockIdempotencyKey(key: string): Promise<void> {
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  async findBatchByKey(key: string): Promise<IngestionBatch | null> {
    const rows = await this.db
      .select()
      .from(ingestionBatches)
      .where(eq(ingestionBatches.idempotencyKey, key))
      .limit(1);
    return firstOrNull(rows);
  }

  async insertBatch(data: NewIngestionBatch): Promise<IngestionBatch> {
    return firstOrThrow(await this.db.insert(ingestionBatches).values(data).returning());
  }

  async sourceExists(sourceId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.id, sourceId), isNull(sources.deletedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async findManhwaIdBySourceUrl(sourceId: string, manhwaUrl: string): Promise<string | null> {
    const rows = await this.db
      .select({ manhwaId: manhwaSources.manhwaId })
      .from(manhwaSources)
      .where(and(eq(manhwaSources.sourceId, sourceId), eq(manhwaSources.manhwaUrl, manhwaUrl)))
      .limit(1);
    return firstOrNull(rows)?.manhwaId ?? null;
  }

  async createManhwa(item: IngestManhwaItem): Promise<string> {
    const rows = await this.db
      .insert(manhwas)
      .values({
        title: item.title,
        originalTitle: item.originalTitle,
        synopsis: item.synopsis,
        coverUrl: item.coverUrl,
        type: item.type,
        status: item.status,
        totalChapters: item.totalChapters,
        createdBy: SCRAPER_ACTOR,
      })
      .returning({ id: manhwas.id });
    return firstOrThrow(rows).id;
  }

  async enrichManhwa(manhwaId: string, data: ManhwaEnrichment): Promise<boolean> {
    const rows = await this.db
      .update(manhwas)
      .set({
        // Champs descriptifs : on complète seulement ce qui est vide (les corrections d'un admin priment).
        ...(data.originalTitle != null ? { originalTitle: sql`COALESCE(${manhwas.originalTitle}, ${data.originalTitle})` } : {}),
        ...(data.synopsis != null ? { synopsis: sql`COALESCE(${manhwas.synopsis}, ${data.synopsis})` } : {}),
        ...(data.coverUrl != null ? { coverUrl: sql`COALESCE(${manhwas.coverUrl}, ${data.coverUrl})` } : {}),
        // Champs vivants : la source fait foi (statut de parution), le compteur ne recule jamais.
        ...(data.status != null ? { status: data.status } : {}),
        ...(data.totalChapters != null
          ? { totalChapters: sql`GREATEST(${manhwas.totalChapters}, ${data.totalChapters})` }
          : {}),
        updatedBy: SCRAPER_ACTOR,
      })
      .where(eq(manhwas.id, manhwaId))
      .returning({ id: manhwas.id });
    return rows.length > 0;
  }

  async addCover(manhwaId: string, imageUrl: string): Promise<boolean> {
    const rows = await this.db
      .insert(manhwaCovers)
      .values({ manhwaId, imageUrl, source: 'scraped' })
      .onConflictDoNothing({ target: [manhwaCovers.manhwaId, manhwaCovers.imageUrl] })
      .returning({ id: manhwaCovers.id });
    return rows.length > 0;
  }

  async upsertChapter(manhwaId: string, item: IngestChapterItem): Promise<{ id: string; created: boolean }> {
    const inserted = await this.db
      .insert(chapters)
      .values({ manhwaId, number: item.number, title: item.title, kind: item.kind, createdBy: SCRAPER_ACTOR })
      // Cible = l'index unique partiel des chapitres actifs (le prédicat doit être répété).
      .onConflictDoNothing({
        target: [chapters.manhwaId, chapters.number],
        where: sql`${chapters.deletedAt} IS NULL`,
      })
      .returning({ id: chapters.id });

    const created = firstOrNull(inserted);
    if (created) return { id: created.id, created: true };

    const existing = await this.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.manhwaId, manhwaId), eq(chapters.number, item.number), isNull(chapters.deletedAt)))
      .limit(1);
    return { id: firstOrThrow(existing).id, created: false };
  }

  async upsertScanlationGroup(name: string): Promise<string> {
    const rows = await this.db
      .insert(scanlationGroups)
      .values({ slug: slugify(name, 'group'), name })
      .onConflictDoUpdate({ target: scanlationGroups.slug, set: { updatedAt: new Date() } })
      .returning({ id: scanlationGroups.id });
    return firstOrThrow(rows).id;
  }

  async upsertRelease(data: NewChapterRelease): Promise<boolean> {
    const rows = await this.db
      .insert(chapterReleases)
      .values(data)
      .onConflictDoUpdate({
        target: [chapterReleases.sourceId, chapterReleases.url],
        set: {
          lastSeenAt: new Date(),
          removedAt: null, // réapparue sur la source
          scanlationGroupId: sql`COALESCE(excluded.scanlation_group_id, ${chapterReleases.scanlationGroupId})`,
          publishedAt: sql`COALESCE(${chapterReleases.publishedAt}, excluded.published_at)`,
        },
      })
      // xmax = 0 ⇔ la ligne vient d'être insérée (et non mise à jour par ON CONFLICT).
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return firstOrThrow(rows).inserted;
  }

  async linkManhwaSource({ manhwaId, sourceId, manhwaUrl, latestChapter }: ManhwaSourceLink): Promise<void> {
    await this.db
      .insert(manhwaSources)
      .values({ manhwaId, sourceId, manhwaUrl, latestChapter, lastScrapedAt: new Date() })
      .onConflictDoUpdate({
        target: [manhwaSources.manhwaId, manhwaSources.sourceId],
        set: {
          manhwaUrl,
          lastScrapedAt: new Date(),
          // GREATEST ignore les NULL : le dernier chapitre connu ne recule jamais.
          latestChapter: sql`GREATEST(${manhwaSources.latestChapter}, ${latestChapter})`,
        },
      });
  }

  async insertRun(data: NewScrapeRun): Promise<ScrapeRun> {
    return firstOrThrow(await this.db.insert(scrapeRuns).values(data).returning());
  }

  async findRun(id: string): Promise<ScrapeRun | null> {
    return firstOrNull(await this.db.select().from(scrapeRuns).where(eq(scrapeRuns.id, id)).limit(1));
  }

  async finishRun(id: string, data: FinishRunInput): Promise<ScrapeRun | null> {
    const rows = await this.db
      .update(scrapeRuns)
      .set({ ...data, finishedAt: new Date() })
      // Garde atomique : seule une exécution encore en cours peut être clôturée.
      .where(and(eq(scrapeRuns.id, id), eq(scrapeRuns.status, 'running')))
      .returning();
    return firstOrNull(rows);
  }

  async insertHealthSamples(samples: NewSourceHealth[]): Promise<number> {
    const rows = await this.db.insert(sourceHealth).values(samples).returning({ id: sourceHealth.id });
    return rows.length;
  }
}
