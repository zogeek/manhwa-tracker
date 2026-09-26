import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { unionAll, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { manhwaTitles } from '../../shared/db/schema.js';
import { manhwas, type ManhwaSearchHit, type NewManhwa, type Manhwa } from './manhwa.schema.js';

export interface ManhwaRepository {
  findAll(): Promise<Manhwa[]>;
  findById(id: Manhwa['id']): Promise<Manhwa | null>;
  insert(data: NewManhwa): Promise<Manhwa>;
  update(id: Manhwa['id'], data: Partial<NewManhwa>): Promise<Manhwa | null>;
  /** `deletedBy` est tracé dans `updated_by`. */
  softDelete(id: Manhwa['id'], deletedBy: string | null): Promise<Manhwa | null>;
  /** Recherche floue (tolérante aux fautes) sur le titre, le titre original et les titres alternatifs. */
  search(query: string, limit: number): Promise<ManhwaSearchHit[]>;
}

/**
 * Seuil de `word_similarity` (0 → 1) au-delà duquel un titre « ressemble » à la requête.
 * 0.6 par défaut dans pg_trgm (trop strict pour des fautes de frappe), 0.3 remonte du bruit.
 */
export const SEARCH_SIMILARITY_THRESHOLD = 0.4;

/** Échappe les jokers LIKE (`%`, `_`, `\`) : la saisie utilisateur est cherchée littéralement. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Condition « le titre correspond » : ressemblance par trigrammes (`<%`, tolère les fautes)
 * OU sous-chaîne exacte (`ILIKE`, utile pour les requêtes de 1-2 caractères).
 * Les deux opérateurs sont servis par les index GIN `gin_trgm_ops`.
 */
const titleMatches = (column: AnyPgColumn, query: string, pattern: string): SQL | undefined =>
  or(sql`${query} <% ${column}`, ilike(column, pattern));

const titleScore = (column: AnyPgColumn, query: string) =>
  sql<number>`word_similarity(${query}, ${column})`.as('score');

/** Implémentation Drizzle. Toutes les lectures/écritures ignorent les manhwas soft-deleted. */
export class DrizzleManhwaRepository implements ManhwaRepository {
  constructor(private readonly db: DbClient) {}

  async findAll(): Promise<Manhwa[]> {
    return this.db.select().from(manhwas).where(isNull(manhwas.deletedAt));
  }

  async findById(id: Manhwa['id']): Promise<Manhwa | null> {
    const rows = await this.db
      .select()
      .from(manhwas)
      .where(and(eq(manhwas.id, id), isNull(manhwas.deletedAt)))
      .limit(1);
    return firstOrNull(rows);
  }

  async insert(data: NewManhwa): Promise<Manhwa> {
    const rows = await this.db.insert(manhwas).values(data).returning();
    return firstOrThrow(rows);
  }

  async update(id: Manhwa['id'], data: Partial<NewManhwa>): Promise<Manhwa | null> {
    const rows = await this.db
      .update(manhwas)
      .set(data)
      .where(and(eq(manhwas.id, id), isNull(manhwas.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async softDelete(id: Manhwa['id'], deletedBy: string | null): Promise<Manhwa | null> {
    const rows = await this.db
      .update(manhwas)
      .set({ deletedAt: new Date(), updatedBy: deletedBy })
      .where(and(eq(manhwas.id, id), isNull(manhwas.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async search(query: string, limit: number): Promise<ManhwaSearchHit[]> {
    const pattern = `%${escapeLike(query)}%`;

    // Transaction : `set_config(…, true)` (≈ SET LOCAL) ne vaut que pour cette transaction,
    // le seuil ne fuit donc pas vers les autres requêtes qui réutiliseront la connexion du pool.
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('pg_trgm.word_similarity_threshold', ${String(SEARCH_SIMILARITY_THRESHOLD)}, true)`,
      );

      // Une ligne par titre qui correspond (principal, original, alternatifs)…
      const matches = unionAll(
        tx
          .select({ manhwaId: manhwas.id, score: titleScore(manhwas.title, query) })
          .from(manhwas)
          .where(and(isNull(manhwas.deletedAt), titleMatches(manhwas.title, query, pattern))),
        tx
          .select({ manhwaId: manhwas.id, score: titleScore(manhwas.originalTitle, query) })
          .from(manhwas)
          .where(and(isNull(manhwas.deletedAt), titleMatches(manhwas.originalTitle, query, pattern))),
        tx
          .select({ manhwaId: manhwaTitles.manhwaId, score: titleScore(manhwaTitles.title, query) })
          .from(manhwaTitles)
          .where(titleMatches(manhwaTitles.title, query, pattern)),
      ).as('matches');

      // … puis une ligne par manhwa, classée par son meilleur titre.
      const score = sql<number>`max(${matches.score})`;
      const rows = await tx
        .select({ manhwa: manhwas, score })
        .from(matches)
        .innerJoin(manhwas, and(eq(manhwas.id, matches.manhwaId), isNull(manhwas.deletedAt)))
        .groupBy(manhwas.id)
        .orderBy(desc(score), asc(manhwas.title))
        .limit(limit);
      return rows.map(({ manhwa, score }) => ({ ...manhwa, score }));
    });
  }
}
