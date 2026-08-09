import { eq, isNull } from "drizzle-orm";
import { db } from "../../shared/db/index.js";
import { manhwas, type Manhwa, type NewManhwa } from "./chapter.schema.js";

export class ManhwaRepository {
  async findAll(): Promise<Manhwa[]> {
    return await db.select().from(manhwas).where(isNull(manhwas.deletedAt));
  }

  async findById(id: Manhwa["id"]): Promise<Manhwa | null> {
    const result = await db.select().from(manhwas).where(eq(manhwas.id, id));
    return result[0] ?? null;
  }

  async insert(data: NewManhwa): Promise<Manhwa> {
    const result = await db.insert(manhwas).values(data).returning();
    return result[0];
  }

  async update(id: Manhwa["id"], data: Partial<NewManhwa>): Promise<Manhwa | null> {
    const result = await db
      .update(manhwas)
      .set(data)
      .where(eq(manhwas.id, id))
      .returning();
    return result[0] ?? null;
  }

  async softDelete(id: Manhwa["id"]): Promise<Manhwa | null> {
    const result = await db
      .update(manhwas)
      .set({ deletedAt: new Date() })
      .where(eq(manhwas.id, id))
      .returning();
    return result[0] ?? null;
  }
}
