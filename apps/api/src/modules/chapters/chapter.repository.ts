import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { chapterReleaseGroups, chapterReleases, scanlationGroups, sources } from '../../shared/db/schema.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import {
  chapters,
  type NewChapter,
  type Chapter,
  type ChapterReleaseSummary,
  type ChapterWithReleases,
} from './chapter.schema.js';

export interface ChapterRepository {
  findAll(): Promise<Chapter[]>;
  /** Chapitres d'une œuvre (ordre croissant) avec leurs parutions en ligne et les teams créditées. */
  findByManhwaId(manhwaId: Chapter['manhwaId']): Promise<ChapterWithReleases[]>;
  findById(id: Chapter['id']): Promise<Chapter | null>;
  insert(data: NewChapter): Promise<Chapter>;
  update(id: Chapter['id'], data: Partial<NewChapter>): Promise<Chapter | null>;
  /** `deletedBy` est tracé dans `updated_by`. */
  softDelete(id: Chapter['id'], deletedBy: string | null): Promise<Chapter | null>;
}

/** Implémentation Drizzle. Toutes les lectures/écritures ignorent les chapters soft-deleted. */
export class DrizzleChapterRepository implements ChapterRepository {
  constructor(private readonly db: DbClient) {}

  async findAll(): Promise<Chapter[]> {
    return this.db.select().from(chapters).where(isNull(chapters.deletedAt));
  }

  /**
   * Deux requêtes au total, quel que soit le nombre de chapitres (pas de N+1), lancées en parallèle :
   * 1. les chapitres de l'œuvre ;
   * 2. TOUTES leurs parutions d'un coup, filtrées par l'œuvre via la jointure sur `chapters`, avec
   *    source et teams en LEFT JOIN (une ligne par couple parution × team, parution sans team incluse).
   * Le regroupement « chapitre → parutions → teams » se fait ensuite en mémoire.
   */
  async findByManhwaId(manhwaId: Chapter['manhwaId']): Promise<ChapterWithReleases[]> {
    const activeChapterOfManhwa = and(eq(chapters.manhwaId, manhwaId), isNull(chapters.deletedAt));

    const [chapterRows, releaseRows] = await Promise.all([
      this.db.select().from(chapters).where(activeChapterOfManhwa).orderBy(asc(chapters.number)),
      this.db
        .select({
          chapterId: chapterReleases.chapterId,
          releaseId: chapterReleases.id,
          url: chapterReleases.url,
          language: chapterReleases.language,
          sourceName: sources.name,
          teamId: scanlationGroups.id,
          teamName: scanlationGroups.name,
          teamWebsiteUrl: scanlationGroups.websiteUrl,
        })
        .from(chapterReleases)
        .innerJoin(chapters, and(eq(chapters.id, chapterReleases.chapterId), activeChapterOfManhwa))
        .innerJoin(sources, and(eq(sources.id, chapterReleases.sourceId), isNull(sources.deletedAt)))
        .leftJoin(chapterReleaseGroups, eq(chapterReleaseGroups.releaseId, chapterReleases.id))
        .leftJoin(scanlationGroups, eq(scanlationGroups.id, chapterReleaseGroups.groupId))
        // Parutions retirées de leur source (DMCA…) : plus lisibles, donc plus affichées.
        .where(isNull(chapterReleases.removedAt))
        .orderBy(
          asc(chapterReleases.language),
          asc(chapterReleases.firstSeenAt),
          asc(chapterReleases.id),
          asc(chapterReleaseGroups.position),
        ),
    ]);

    const releasesByChapter = new Map<string, ChapterReleaseSummary[]>();
    const releasesById = new Map<string, ChapterReleaseSummary>();
    for (const row of releaseRows) {
      let release = releasesById.get(row.releaseId);
      if (!release) {
        release = { id: row.releaseId, url: row.url, language: row.language, sourceName: row.sourceName, teams: [] };
        releasesById.set(row.releaseId, release);
        const siblings = releasesByChapter.get(row.chapterId);
        if (siblings) siblings.push(release);
        else releasesByChapter.set(row.chapterId, [release]);
      }
      // LEFT JOIN : une parution sans team ramène une ligne dont les colonnes de team sont NULL.
      if (row.teamId !== null && row.teamName !== null) {
        release.teams.push({ id: row.teamId, name: row.teamName, websiteUrl: row.teamWebsiteUrl });
      }
    }

    return chapterRows.map((chapter) => ({ ...chapter, releases: releasesByChapter.get(chapter.id) ?? [] }));
  }

  async findById(id: Chapter['id']): Promise<Chapter | null> {
    const rows = await this.db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, id), isNull(chapters.deletedAt)))
      .limit(1);
    return firstOrNull(rows);
  }

  async insert(data: NewChapter): Promise<Chapter> {
    const rows = await this.db.insert(chapters).values(data).returning();
    return firstOrThrow(rows);
  }

  async update(id: Chapter['id'], data: Partial<NewChapter>): Promise<Chapter | null> {
    const rows = await this.db
      .update(chapters)
      .set(data)
      .where(and(eq(chapters.id, id), isNull(chapters.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async softDelete(id: Chapter['id'], deletedBy: string | null): Promise<Chapter | null> {
    const rows = await this.db
      .update(chapters)
      .set({ deletedAt: new Date(), updatedBy: deletedBy })
      .where(and(eq(chapters.id, id), isNull(chapters.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }
}
