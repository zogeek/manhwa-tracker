import { and, asc, eq, sql } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import {
  manhwaTerms,
  terms,
  vocabularies,
  type ManhwaTag,
  type ManhwaTerm,
  type NewManhwaTerm,
  type NewTerm,
  type NewVocabulary,
  type Term,
  type Vocabulary,
} from './taxonomy.schema.js';

export interface TaxonomyRepository {
  findVocabularies(): Promise<Vocabulary[]>;
  findVocabularyById(id: string): Promise<Vocabulary | null>;
  findVocabularyBySlug(slug: string): Promise<Vocabulary | null>;
  insertVocabulary(data: NewVocabulary): Promise<Vocabulary>;
  findTermsByVocabulary(vocabularyId: string): Promise<Term[]>;
  findTermById(id: string): Promise<Term | null>;
  /** Identifiants de tous les ancêtres d'un terme (parent, grand-parent…), terme exclu. */
  findAncestorIds(termId: string): Promise<string[]>;
  hasChildren(termId: string): Promise<boolean>;
  insertTerm(data: NewTerm): Promise<Term>;
  updateTerm(id: string, data: Partial<NewTerm>): Promise<Term | null>;
  deleteTerm(id: string): Promise<Term | null>;
  findManhwaTags(manhwaId: string): Promise<ManhwaTag[]>;
  upsertManhwaTerm(data: NewManhwaTerm): Promise<ManhwaTerm>;
  deleteManhwaTerm(manhwaId: string, termId: string): Promise<ManhwaTerm | null>;
}

export class DrizzleTaxonomyRepository implements TaxonomyRepository {
  constructor(private readonly db: DbClient) {}

  async findVocabularies(): Promise<Vocabulary[]> {
    return this.db.select().from(vocabularies).orderBy(asc(vocabularies.name));
  }

  async findVocabularyById(id: string): Promise<Vocabulary | null> {
    return firstOrNull(await this.db.select().from(vocabularies).where(eq(vocabularies.id, id)).limit(1));
  }

  async findVocabularyBySlug(slug: string): Promise<Vocabulary | null> {
    return firstOrNull(await this.db.select().from(vocabularies).where(eq(vocabularies.slug, slug)).limit(1));
  }

  async insertVocabulary(data: NewVocabulary): Promise<Vocabulary> {
    return firstOrThrow(await this.db.insert(vocabularies).values(data).returning());
  }

  async findTermsByVocabulary(vocabularyId: string): Promise<Term[]> {
    return this.db.select().from(terms).where(eq(terms.vocabularyId, vocabularyId)).orderBy(asc(terms.name));
  }

  async findTermById(id: string): Promise<Term | null> {
    return firstOrNull(await this.db.select().from(terms).where(eq(terms.id, id)).limit(1));
  }

  async findAncestorIds(termId: string): Promise<string[]> {
    // CTE récursive : on remonte parent par parent. UNION (et non UNION ALL) stoppe un cycle éventuel.
    const result = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT ${terms.id}, ${terms.parentId} FROM ${terms} WHERE ${terms.id} = ${termId}
        UNION
        SELECT t.id, t.parent_id FROM ${terms} t JOIN ancestors a ON t.id = a.parent_id
      )
      SELECT id FROM ancestors WHERE id <> ${termId}
    `);
    return result.rows.map((row) => row.id);
  }

  async hasChildren(termId: string): Promise<boolean> {
    const rows = await this.db.select({ id: terms.id }).from(terms).where(eq(terms.parentId, termId)).limit(1);
    return rows.length > 0;
  }

  async insertTerm(data: NewTerm): Promise<Term> {
    return firstOrThrow(await this.db.insert(terms).values(data).returning());
  }

  async updateTerm(id: string, data: Partial<NewTerm>): Promise<Term | null> {
    return firstOrNull(await this.db.update(terms).set(data).where(eq(terms.id, id)).returning());
  }

  async deleteTerm(id: string): Promise<Term | null> {
    return firstOrNull(await this.db.delete(terms).where(eq(terms.id, id)).returning());
  }

  async findManhwaTags(manhwaId: string): Promise<ManhwaTag[]> {
    const rows = await this.db
      .select({ tag: manhwaTerms, term: terms, vocabularySlug: vocabularies.slug })
      .from(manhwaTerms)
      .innerJoin(terms, eq(manhwaTerms.termId, terms.id))
      .innerJoin(vocabularies, eq(terms.vocabularyId, vocabularies.id))
      .where(eq(manhwaTerms.manhwaId, manhwaId))
      .orderBy(asc(vocabularies.slug), asc(terms.name));
    return rows.map(({ tag, term, vocabularySlug }) => ({ ...tag, term, vocabularySlug }));
  }

  async upsertManhwaTerm(data: NewManhwaTerm): Promise<ManhwaTerm> {
    const rows = await this.db
      .insert(manhwaTerms)
      .values(data)
      .onConflictDoUpdate({
        target: [manhwaTerms.manhwaId, manhwaTerms.termId],
        set: { relevance: data.relevance, isSpoiler: data.isSpoiler, source: data.source },
      })
      .returning();
    return firstOrThrow(rows);
  }

  async deleteManhwaTerm(manhwaId: string, termId: string): Promise<ManhwaTerm | null> {
    const rows = await this.db
      .delete(manhwaTerms)
      .where(and(eq(manhwaTerms.manhwaId, manhwaId), eq(manhwaTerms.termId, termId)))
      .returning();
    return firstOrNull(rows);
  }
}
