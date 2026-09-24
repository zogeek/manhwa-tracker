import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { sources, type NewSource, type Source } from './source.schema.js';

export interface SourceRepository {
  findAll(): Promise<Source[]>;
  findById(id: Source['id']): Promise<Source | null>;
  insert(data: NewSource): Promise<Source>;
  update(id: Source['id'], data: Partial<NewSource>): Promise<Source | null>;
  /** `deletedBy` est tracé dans `updated_by`. */
  softDelete(id: Source['id'], deletedBy: string | null): Promise<Source | null>;
}

/** Implémentation Drizzle. Toutes les lectures/écritures ignorent les sources soft-deleted. */
export class DrizzleSourceRepository implements SourceRepository {
  constructor(private readonly db: DbClient) {}

  async findAll(): Promise<Source[]> {
    return this.db.select().from(sources).where(isNull(sources.deletedAt));
  }

  async findById(id: Source['id']): Promise<Source | null> {
    const rows = await this.db
      .select()
      .from(sources)
      .where(and(eq(sources.id, id), isNull(sources.deletedAt)))
      .limit(1);
    return firstOrNull(rows);
  }

  async insert(data: NewSource): Promise<Source> {
    const rows = await this.db.insert(sources).values(data).returning();
    return firstOrThrow(rows);
  }

  async update(id: Source['id'], data: Partial<NewSource>): Promise<Source | null> {
    const rows = await this.db
      .update(sources)
      .set(data)
      .where(and(eq(sources.id, id), isNull(sources.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }

  async softDelete(id: Source['id'], deletedBy: string | null): Promise<Source | null> {
    const rows = await this.db
      .update(sources)
      .set({ deletedAt: new Date(), updatedBy: deletedBy })
      .where(and(eq(sources.id, id), isNull(sources.deletedAt)))
      .returning();
    return firstOrNull(rows);
  }
}
