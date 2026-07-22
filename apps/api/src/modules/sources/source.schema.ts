import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { pgTable, text, uuid, boolean, timestamp } from "drizzle-orm/pg-core";

export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  language: text('language').default('fr').notNull(),
  iconUrl: text('icon_url'),
  isOfficial: boolean('is_official').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  deletedAt: timestamp('deleted_at'),
});

export type Source = InferSelectModel<typeof sources>;
export type NewSource = InferInsertModel<typeof sources>;