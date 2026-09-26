import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
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
import {
  externalRefKey,
  type ExternalManhwa,
  type ExternalProvider,
  type ExternalRef,
  type ExternalTag,
} from './external-catalog.js';

/** Provenance des tags posés par l'import (≠ `curated` d'un admin, ≠ `scraper`). */
const EXTERNAL_TERM_SOURCE: NewManhwaTerm['source'] = 'external';

export type ExternalLinkTarget = {
  manhwaId: string;
  /** La fiche liée a été soft-deleted par un admin. */
  deleted: boolean;
};

export type VocabularyRef = { slug: string; name: string };

export interface DiscoveryRepository {
  /**
   * Sérialise les imports concurrents touchant l'une de ces références (verrous libérés au COMMIT/ROLLBACK).
   * Verrouiller aussi les références croisées empêche « AniList #1 » et « MangaDex X → AniList #1 »
   * importés au même instant de créer deux fiches.
   */
  lockExternalRefs(refs: readonly ExternalRef[]): Promise<void>;
  findLinkedManhwa(provider: ExternalProvider, externalId: string): Promise<ExternalLinkTarget | null>;
  /** `provider:externalId` → manhwaId, pour les œuvres déjà présentes (et actives) dans le catalogue. */
  findImportedManhwaIds(refs: readonly ExternalRef[]): Promise<Map<string, string>>;
  /** Crée la fiche, ses titres alternatifs, sa couverture et son lien externe. Renvoie l'id du manhwa. */
  insertImportedManhwa(item: ExternalManhwa, userId: string): Promise<string>;
  /**
   * Rattache des références externes à une fiche. Ignore celles déjà prises (par cette fiche ou,
   * pour un même fournisseur, par une autre). Renvoie le nombre de liens créés.
   */
  linkExternalRefs(manhwaId: string, refs: readonly ExternalRef[]): Promise<number>;
  /**
   * Rattache des termes au manhwa, en les créant à la volée dans le vocabulaire (créé s'il manque).
   * Un nom est d'abord résolu par les alias existants (« Sci-Fi » → terme « science-fiction »).
   * Renvoie le nombre de termes rattachés.
   */
  attachTerms(manhwaId: string, vocabulary: VocabularyRef, tags: readonly ExternalTag[]): Promise<number>;
}

export class DrizzleDiscoveryRepository implements DiscoveryRepository {
  constructor(private readonly db: DbClient) {}

  async lockExternalRefs(refs: readonly ExternalRef[]): Promise<void> {
    // Ordre global stable : deux transactions qui verrouillent {A, B} et {B, A} ne s'interbloquent pas.
    const keys = [...new Set(refs.map(externalRefKey))].sort();
    for (const key of keys) {
      await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`import:${key}`}, 0))`);
    }
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

  async findImportedManhwaIds(refs: readonly ExternalRef[]): Promise<Map<string, string>> {
    const idsByProvider = new Map<ExternalProvider, Set<string>>();
    for (const { provider, externalId } of refs) {
      idsByProvider.set(provider, (idsByProvider.get(provider) ?? new Set()).add(externalId));
    }
    if (idsByProvider.size === 0) return new Map();

    const rows = await this.db
      .select({ provider: externalLinks.provider, externalId: externalLinks.externalId, manhwaId: externalLinks.manhwaId })
      .from(externalLinks)
      .innerJoin(manhwas, and(eq(manhwas.id, externalLinks.manhwaId), isNull(manhwas.deletedAt)))
      .where(
        or(
          ...[...idsByProvider].map(([provider, ids]) =>
            and(eq(externalLinks.provider, provider), inArray(externalLinks.externalId, [...ids])),
          ),
        ),
      );
    return new Map(rows.map((row) => [`${row.provider}:${row.externalId}`, row.manhwaId]));
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

  async linkExternalRefs(manhwaId: string, refs: readonly ExternalRef[]): Promise<number> {
    if (refs.length === 0) return 0;
    const inserted = await this.db
      .insert(externalLinks)
      .values(refs.map(({ provider, externalId, url }) => ({ manhwaId, provider, externalId, externalUrl: url })))
      // Deux contraintes possibles (fiche+fournisseur, fournisseur+id) : on les ignore toutes les deux.
      .onConflictDoNothing()
      .returning({ id: externalLinks.id });
    return inserted.length;
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
