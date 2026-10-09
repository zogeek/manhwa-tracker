import { and, asc, eq, exists, gt, isNull, notInArray, sql } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import {
  chapterReleaseGroups,
  chapters,
  manhwaCovers,
  manhwaSources,
  manhwas,
  readingListItems,
  readingLists,
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

/** Team à rattacher : identifiée par son id fournisseur si connu, sinon par son nom. */
export type TeamInput = {
  name: string | null;
  websiteUrl: string | null;
  /** Fournisseur qui la connaît sous `externalId` (ex. 'mangadex') ; `null` pour le scraper (nom seul). */
  provider: string | null;
  externalId: string | null;
};

/** Œuvre suivie par au moins un lecteur, telle que connue sur une source donnée. */
export type TrackedSeries = {
  manhwaId: string;
  title: string;
  manhwaUrl: string | null;
  latestChapter: number | null;
  lastScrapedAt: Date | null;
};

export type TrackedSeriesPageQuery = { cursor?: string; limit: number };

export type UpsertedRelease = { id: string; created: boolean };

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
  /**
   * Upsert idempotent d'une team : retrouvée par son id fournisseur, sinon par son nom normalisé,
   * sinon créée. Jamais de doublon (« Asura Scans » reste une seule ligne, quel que soit le nombre
   * de chapitres). `null` si elle ne peut être identifiée (id inconnu ET nom absent).
   */
  upsertTeam(team: TeamInput): Promise<string | null>;
  /** Crée ou rafraîchit la parution (clé : source + URL). */
  upsertRelease(data: NewChapterRelease): Promise<UpsertedRelease>;
  /**
   * Aligne les teams créditées d'une parution sur la source (ordre = position). Une liste vide ne
   * change rien : une source qui ne précise pas les teams n'efface pas celles déjà connues.
   */
  setReleaseTeams(releaseId: string, teamIds: readonly string[]): Promise<void>;
  linkManhwaSource(link: ManhwaSourceLink): Promise<void>;
  insertRun(data: NewScrapeRun): Promise<ScrapeRun>;
  findRun(id: string): Promise<ScrapeRun | null>;
  finishRun(id: string, data: FinishRunInput): Promise<ScrapeRun | null>;
  insertHealthSamples(samples: NewSourceHealth[]): Promise<number>;
  /**
   * Œuvres liées à la source et présentes dans au moins une liste de lecture active, une seule
   * fois chacune, triées par `manhwaId` (pagination par curseur : ids strictement après `cursor`).
   */
  findTrackedSeries(sourceId: string, page: TrackedSeriesPageQuery): Promise<TrackedSeries[]>;
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

  async upsertTeam({ name, websiteUrl, provider, externalId }: TeamInput): Promise<string | null> {
    // 1. Par identifiant fournisseur : résiste aux changements de nom de la team.
    if (provider && externalId) {
      const known = await this.db
        .select({ id: scanlationGroups.id })
        .from(scanlationGroups)
        .where(and(eq(scanlationGroups.provider, provider), eq(scanlationGroups.externalId, externalId)))
        .limit(1);
      const found = firstOrNull(known);
      if (found) return found.id;
    }
    if (!name) return null;

    // 2. Par nom normalisé (upsert sur l'index unique `slug`) : la team connue sous ce nom est
    //    réutilisée, et reçoit l'identifiant fournisseur si elle n'en avait pas encore.
    const withIdentity = provider && externalId ? { provider, externalId } : {};
    const rows = await this.db
      .insert(scanlationGroups)
      .values({ slug: slugify(name, 'group'), name, websiteUrl, ...withIdentity })
      .onConflictDoUpdate({
        target: scanlationGroups.slug,
        set: {
          updatedAt: new Date(),
          websiteUrl: sql`COALESCE(${scanlationGroups.websiteUrl}, excluded.website_url)`,
          // Fournisseur et id vont toujours de pair (contrainte CHECK) : on complète les deux ou aucun.
          provider: sql`COALESCE(${scanlationGroups.provider}, excluded.provider)`,
          externalId: sql`CASE WHEN ${scanlationGroups.provider} IS NULL THEN excluded.external_id ELSE ${scanlationGroups.externalId} END`,
        },
      })
      .returning({ id: scanlationGroups.id });
    return firstOrThrow(rows).id;
  }

  async setReleaseTeams(releaseId: string, teamIds: readonly string[]): Promise<void> {
    const ordered = [...new Set(teamIds)];
    if (ordered.length === 0) return;
    await this.db
      .delete(chapterReleaseGroups)
      .where(and(eq(chapterReleaseGroups.releaseId, releaseId), notInArray(chapterReleaseGroups.groupId, ordered)));
    await this.db
      .insert(chapterReleaseGroups)
      .values(ordered.map((groupId, position) => ({ releaseId, groupId, position })))
      .onConflictDoUpdate({
        target: [chapterReleaseGroups.releaseId, chapterReleaseGroups.groupId],
        set: { position: sql`excluded.position` },
      });
  }

  async upsertRelease(data: NewChapterRelease): Promise<UpsertedRelease> {
    const rows = await this.db
      .insert(chapterReleases)
      .values(data)
      .onConflictDoUpdate({
        target: [chapterReleases.sourceId, chapterReleases.url],
        set: {
          lastSeenAt: new Date(),
          removedAt: null, // réapparue sur la source
          publishedAt: sql`COALESCE(${chapterReleases.publishedAt}, excluded.published_at)`,
        },
      })
      // xmax = 0 ⇔ la ligne vient d'être insérée (et non mise à jour par ON CONFLICT).
      .returning({ id: chapterReleases.id, inserted: sql<boolean>`(xmax = 0)` });
    const { id, inserted } = firstOrThrow(rows);
    return { id, created: inserted };
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

  async findTrackedSeries(sourceId: string, { cursor, limit }: TrackedSeriesPageQuery): Promise<TrackedSeries[]> {
    // Semi-jointure (EXISTS) plutôt que JOIN : une œuvre présente dans N listes ne sort qu'une fois,
    // sans DISTINCT ni GROUP BY, et Postgres s'arrête à la première liste trouvée.
    const inAnActiveReadingList = this.db
      .select({ one: sql`1` })
      .from(readingListItems)
      .innerJoin(readingLists, eq(readingLists.id, readingListItems.listId))
      .where(and(eq(readingListItems.manhwaId, manhwaSources.manhwaId), isNull(readingLists.deletedAt)));

    return this.db
      .select({
        manhwaId: manhwaSources.manhwaId,
        title: manhwas.title,
        manhwaUrl: manhwaSources.manhwaUrl,
        latestChapter: manhwaSources.latestChapter,
        lastScrapedAt: manhwaSources.lastScrapedAt,
      })
      .from(manhwaSources)
      .innerJoin(manhwas, eq(manhwas.id, manhwaSources.manhwaId))
      .where(
        and(
          eq(manhwaSources.sourceId, sourceId),
          isNull(manhwas.deletedAt),
          exists(inAnActiveReadingList),
          cursor ? gt(manhwaSources.manhwaId, cursor) : undefined,
        ),
      )
      .orderBy(asc(manhwaSources.manhwaId))
      .limit(limit);
  }
}
