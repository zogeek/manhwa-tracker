import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull } from '../../shared/db/utils.js';
import { manhwas, readingListItems, readingLists, readingProgress, sources } from '../../shared/db/schema.js';
import { manhwaSources, type ManhwaSource, type ManhwaSourceLink } from './manhwa-source.schema.js';

export interface ManhwaSourceRepository {
  /** Lien d'une œuvre et d'une source toutes deux actives (non soft-deleted), ou `null`. */
  findLink(manhwaId: string, sourceId: string): Promise<ManhwaSourceLink | null>;
  /** L'utilisateur suit-il l'œuvre (liste de lecture active ou progression) ? */
  isFollowedBy(manhwaId: string, userId: string): Promise<boolean>;
  /** Remplace l'URL ; les données scrapées sur l'ancienne page (dernier chapitre, date) sont effacées. */
  updateUrl(manhwaId: string, sourceId: string, manhwaUrl: string | null): Promise<ManhwaSource | null>;
}

/** Implémentation Drizzle. */
export class DrizzleManhwaSourceRepository implements ManhwaSourceRepository {
  constructor(private readonly db: DbClient) {}

  async findLink(manhwaId: string, sourceId: string): Promise<ManhwaSourceLink | null> {
    const rows = await this.db
      .select({ link: manhwaSources, sourceBaseUrl: sources.baseUrl })
      .from(manhwaSources)
      .innerJoin(sources, and(eq(sources.id, manhwaSources.sourceId), isNull(sources.deletedAt)))
      .innerJoin(manhwas, and(eq(manhwas.id, manhwaSources.manhwaId), isNull(manhwas.deletedAt)))
      .where(and(eq(manhwaSources.manhwaId, manhwaId), eq(manhwaSources.sourceId, sourceId)))
      .limit(1);
    const row = firstOrNull(rows);
    return row ? { ...row.link, sourceBaseUrl: row.sourceBaseUrl } : null;
  }

  async isFollowedBy(manhwaId: string, userId: string): Promise<boolean> {
    const [inAReadingList, withProgress] = await Promise.all([
      this.db
        .select({ id: readingListItems.id })
        .from(readingListItems)
        .innerJoin(readingLists, eq(readingLists.id, readingListItems.listId))
        .where(
          and(
            eq(readingListItems.manhwaId, manhwaId),
            eq(readingLists.userId, userId),
            isNull(readingLists.deletedAt),
          ),
        )
        .limit(1),
      this.db
        .select({ id: readingProgress.id })
        .from(readingProgress)
        .where(and(eq(readingProgress.manhwaId, manhwaId), eq(readingProgress.userId, userId)))
        .limit(1),
    ]);
    return inAReadingList.length > 0 || withProgress.length > 0;
  }

  async updateUrl(manhwaId: string, sourceId: string, manhwaUrl: string | null): Promise<ManhwaSource | null> {
    const rows = await this.db
      .update(manhwaSources)
      .set({ manhwaUrl, latestChapter: null, lastScrapedAt: null })
      .where(and(eq(manhwaSources.manhwaId, manhwaId), eq(manhwaSources.sourceId, sourceId)))
      .returning();
    return firstOrNull(rows);
  }
}
