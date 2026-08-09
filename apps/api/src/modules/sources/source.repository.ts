import { eq, isNull } from "drizzle-orm";
import { db } from "../../shared/db/index.js";
import { sources, type Source, type NewSource } from "./source.schema.js";

export class SourceRepository {
  /** Retourne toutes les sources actives (soft-deleted exclues). */
  async findAll(): Promise<Source[]> {
    return db.select().from(sources).where(isNull(sources.deletedAt));
  }

  /** Retourne une source par ID, ou null si non trouvée. */
  async findById(id: Source["id"]): Promise<Source | null> {
    const result = await db.select().from(sources).where(eq(sources.id, id));
    return result[0] ?? null;
  }

  /** Insère une nouvelle source et retourne l'entité créée. */
  async insert(data: NewSource): Promise<Source> {
    const result = await db.insert(sources).values(data).returning();
    return result[0];
  }

  /** Met à jour les champs fournis et retourne l'entité modifiée. */
  async update(
    id: Source["id"],
    data: Partial<NewSource>,
  ): Promise<Source | null> {
    const result = await db
      .update(sources)
      .set(data)
      .where(eq(sources.id, id))
      .returning();
    return result[0] ?? null;
  }

  /** Soft delete — marque la source comme supprimée sans la retirer de la DB. */
  async softDelete(id: Source["id"]): Promise<Source | null> {
    const result = await db
      .update(sources)
      .set({ deletedAt: new Date() })
      .where(eq(sources.id, id))
      .returning();
    return result[0] ?? null;
  }
}
