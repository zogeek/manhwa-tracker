import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const manhwas = pgTable('manhwas', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  coverUrl: text('cover_url'),
  currentChapterRead: integer('current_chapter_read').default(0).notNull(),
  latestChapterAvailable: integer('latest_chapter_available').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});