import {db} from "../../shared/db/index.js";
import {eq, isNull} from "drizzle-orm";
import {sources, type Source} from "./source.schema.js";

export class SourceRepository {

    async findAll() {
        return await db.select().from(sources).where(isNull(sources.deletedAt));
    }

    async findById(id: Source['id']) {
        const result = await db.select().from(sources).where(eq(sources.id, id));
        return result[0] ?? null;
    }

    async create(data : any) {
        return await db.insert(sources);
    }

    async delete(id: Source['id']) {
        return await db.update(sources).set({ deletedAt: new Date() }).where(eq(sources.id, id));
    }

    async update() {

    }
}