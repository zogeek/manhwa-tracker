import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import {
  externalLinks,
  manhwaCovers,
  manhwaTerms,
  manhwaTitles,
  manhwas,
  termAliases,
  terms,
  vocabularies,
} from '../../shared/db/schema.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { slugify } from '../../shared/lib/slug.js';
import type { NewManhwaTerm } from '../taxonomy/taxonomy.schema.js';
import type { ExternalManhwa, ExternalProvider, ExternalTag } from './external-catalog.js';

/** Provenance des tags posés par l'import (≠ `curated` d'un admin, ≠ `scraper`). */
const EXTERNAL_TERM_SOURCE: NewManhwaTerm['source'] = 'external';

export type ExternalLinkTarget = {
  manhwaId: string;
  /** La fiche liée a été soft-deleted par un admin. */
  deleted: boolean;
};

export type VocabularyRef = { slug: string; name: string };

export interface DiscoveryRepository {
  /** Sérialise les imports concurrents d'une même œuvre (verrou libéré au COMMIT/ROLLBACK). */
  lockExternalRef(provider: ExternalProvider, externalId: string): Promise<void>;
  findLinkedManhwa(provider: ExternalProvider, externalId: string): Promise<ExternalLinkTarget | null>;
  /** externalId → manhwaId, pour les œuvres déjà présentes (et actives) dans le catalogue. */
  findImportedManhwaIds(provider: ExternalProvider, externalIds: readonly string[]): Promise<Map<string, string>>;
  /** Crée la fiche, ses titres alternatifs, sa couverture et son lien externe. Renvoie l'id du manhwa. */
  insertImportedManhwa(item: ExternalManhwa, userId: string): Promise<string>;
  /**
   * Rattache des termes au manhwa, en les créant à la volée dans le vocabulaire (créé s'il manque).
   * Un nom est d'abord résolu par les alias existants (« Sci-Fi » → terme « science-fiction »).
   * Renvoie le nombre de termes rattachés.
   */
  attachTerms(manhwaId: string, vocabulary: VocabularyRef, tags: readonly ExternalTag[]): Promise<number>;
}

export class DrizzleDiscoveryRepository implements DiscoveryRepository {
  constructor(private readonly db: DbClient) {}

  async lockExternalRef(provider: ExternalProvider, externalId: string): Promise<void> {
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`import:${provider}:${externalId}`}, 0))`);
  }

  async findLinkedManhwa(provider: ExternalProvider, externalId: string): Promise<ExternalLinkTarget | null> {
    const rows = await this.db
      .select({ manhwaId: externalLinks.manhwaId, deletedAt: manhwas.deletedAt })
      .from(externalLinks)
      .innerJoin(manhwas, eq(manhwas.id, externalLinks.manhwaId))
      .where(and(eq(externalLinks.provider, provider), eq(externalLinks.externalId, externalId)))
      .limit(1);
    const row = firstOrNull(rows);
    return row ? { manhwaId: row.manhwaId, deleted: row.deletedAt !== null } : null;
  }

  async findImportedManhwaIds(provider: ExternalProvider, externalIds: readonly string[]): Promise<Map<string, string>> {
    if (externalIds.length === 0) return new Map();
    const rows = await this.db
      .select({ externalId: externalLinks.externalId, manhwaId: externalLinks.manhwaId })
      .from(externalLinks)
      .innerJoin(manhwas, and(eq(manhwas.id, externalLinks.manhwaId), isNull(manhwas.deletedAt)))
      .where(and(eq(externalLinks.provider, provider), inArray(externalLinks.externalId, [...externalIds])));
    return new Map(rows.map((row) => [row.externalId, row.manhwaId]));
  }

  async insertImportedManhwa(item: ExternalManhwa, userId: string): Promise<string> {
    const { id: manhwaId } = firstOrThrow(
      await this.db
        .insert(manhwas)
        .values({
          title: item.title,
          originalTitle: item.originalTitle,
          synopsis: item.synopsis,
          coverUrl: item.coverUrl,
          type: item.type,
          status: item.status,
          totalChapters: item.totalChapters,
          rating: item.rating,
          startDate: item.startDate,
          endDate: item.endDate,
          createdBy: userId,
        })
        .returning({ id: manhwas.id }),
    );

    if (item.alternativeTitles.length > 0) {
      await this.db
        .insert(manhwaTitles)
        .values(item.alternativeTitles.map(({ title, language }) => ({ manhwaId, title, language })));
    }

    await this.db.insert(externalLinks).values({
      manhwaId,
      provider: item.provider,
      externalId: item.externalId,
      externalUrl: item.url,
    });

    if (item.coverUrl) {
      await this.db
        .insert(manhwaCovers)
        .values({ manhwaId, imageUrl: item.coverUrl, source: item.provider, isPrimary: true });
    }

    return manhwaId;
  }

  async attachTerms(manhwaId: string, vocabulary: VocabularyRef, tags: readonly ExternalTag[]): Promise<number> {
    // Un même nom (à la casse près) ne compte qu'une fois : on garde sa meilleure pertinence.
    const byName = new Map<string, ExternalTag>();
    for (const tag of tags) {
      const key = tag.name.toLowerCase();
      const current = byName.get(key);
      if (tag.name && (!current || tag.relevance > current.relevance)) byName.set(key, tag);
    }
    if (byName.size === 0) return 0;

    await this.db.insert(vocabularies).values(vocabulary).onConflictDoNothing({ target: vocabularies.slug });
    const { id: vocabularyId } = firstOrThrow(
      await this.db.select({ id: vocabularies.id }).from(vocabularies).where(eq(vocabularies.slug, vocabulary.slug)),
    );

    // 1. Résolution par alias (insensible à la casse), dans ce vocabulaire uniquement.
    const aliasRows = await this.db
      .select({ termId: termAliases.termId, alias: sql<string>`lower(${termAliases.alias})` })
      .from(termAliases)
      .innerJoin(terms, and(eq(terms.id, termAliases.termId), eq(terms.vocabularyId, vocabularyId)))
      .where(inArray(sql`lower(${termAliases.alias})`, [...byName.keys()]));
    const termIdByName = new Map(aliasRows.map((row) => [row.alias, row.termId]));

    // 2. Les autres noms : upsert par slug (le terme existe déjà ou est créé à la volée).
    const bySlug = new Map<string, string>();
    for (const [key, tag] of byName) {
      if (!termIdByName.has(key)) bySlug.set(slugify(tag.name, 'term'), tag.name);
    }
    if (bySlug.size > 0) {
      const upserted = await this.db
        .insert(terms)
        .values([...bySlug].map(([slug, name]) => ({ vocabularyId, slug, name })))
        // DO UPDATE (et non DO NOTHING) pour que RETURNING renvoie aussi les termes existants.
        .onConflictDoUpdate({ target: [terms.vocabularyId, terms.slug], set: { updatedAt: new Date() } })
        .returning({ id: terms.id, slug: terms.slug });
      const idBySlug = new Map(upserted.map((row) => [row.slug, row.id]));
      for (const [key, tag] of byName) {
        const termId = idBySlug.get(slugify(tag.name, 'term'));
        if (termId && !termIdByName.has(key)) termIdByName.set(key, termId);
      }
    }

    // 3. Pivot manhwa ↔ terme (deux noms peuvent désigner le même terme : on dédoublonne).
    const links = new Map<string, ExternalTag>();
    for (const [key, tag] of byName) {
      const termId = termIdByName.get(key);
      const current = termId ? links.get(termId) : undefined;
      if (termId && (!current || tag.relevance > current.relevance)) links.set(termId, tag);
    }
    const inserted = await this.db
      .insert(manhwaTerms)
      .values(
        [...links].map(([termId, tag]) => ({
          manhwaId,
          termId,
          relevance: tag.relevance,
          isSpoiler: tag.isSpoiler,
          source: EXTERNAL_TERM_SOURCE,
        })),
      )
      .onConflictDoNothing()
      .returning({ termId: manhwaTerms.termId });
    return inserted.length;
  }
}
