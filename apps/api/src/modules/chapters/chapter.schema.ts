import { pgTable, uuid, text, timestamp, integer, date, uniqueIndex, index } from "drizzle-orm/pg-core";
import { manhwas } from "../manhwas/manhwa.schema.js";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";


export const chapters = pgTable('chapters', {
  id: uuid('id').defaultRandom().primaryKey(),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  title: text('title'),
  releaseDate: date('release_date'),
  // Audit
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('chapters_manhwa_number_idx').on(table.manhwaId, table.number),
  index('chapters_manhwa_id_idx').on(table.manhwaId),
]);

export type Chapters = InferSelectModel<typeof chapters>;
export type NewChapters = InferInsertModel<typeof chapters>;