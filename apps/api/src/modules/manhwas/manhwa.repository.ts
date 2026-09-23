import { and, eq, isNull } from 'drizzle-orm';
import type { DbClient } from '../../shared/db/index.js';
import { firstOrNull, firstOrThrow } from '../../shared/db/utils.js';
import { manhwas, type NewManhwa, type Manhwa } from './manhwa.schema.js';

export interface ManhwaRepository {
  findAll(): Promise<Manhwa[]>;
  findById(id: Manhwa['id']): Promise<Manhwa | null>;
  insert(data: NewManhwa): Promise<Manhwa>;
  update(id: Manhwa['id'], data: Partial<NewManhwa>): Promise<Manhwa | null>;
  /** `deletedBy` est tracé dans `updated_by`. */
  softDelete(id: Manhwa['id'], deletedBy: string | null): Promise<Manhwa | null>;
}

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
}
