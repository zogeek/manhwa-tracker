import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  real,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ============================================================
// ENUMS
// ============================================================

export const manhwaTypeEnum = pgEnum('manhwa_type', [
  'manga',
  'manhwa',
  'manhua',
  'webtoon',
]);

export const manhwaStatusEnum = pgEnum('manhwa_status', [
  'ongoing',
  'completed',
  'hiatus',
  'cancelled',
]);

export const readingStatusEnum = pgEnum('reading_status', [
  'reading',
  'completed',
  'on_hold',
  'dropped',
  'plan_to_read',
]);

export const authorRoleEnum = pgEnum('author_role', [
  'story',
  'art',
  'both',
]);

export const chapterQualityEnum = pgEnum('chapter_quality', [
  'hd',
  'sd',
  'raw',
]);

export const auditActionEnum = pgEnum('audit_action', [
  'create',
  'update',
  'delete',
]);

// ============================================================
// MANHWAS — Série enrichie
// ============================================================

export const manhwas = pgTable('manhwas', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  originalTitle: text('original_title'),
  synopsis: text('synopsis'),
  coverUrl: text('cover_url'),
  type: manhwaTypeEnum('type').default('manhwa').notNull(),
  status: manhwaStatusEnum('status').default('ongoing').notNull(),
  country: text('country').default('KR'),
  totalChapters: integer('total_chapters'),
  rating: real('rating'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  // Audit
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  createdBy: text('created_by'), // user_id Better Auth
  updatedBy: text('updated_by'), // user_id Better Auth
  deletedAt: timestamp('deleted_at'), // null = actif, sinon soft-deleted
});

// ============================================================
// MANHWA TITLES — Titres alternatifs (multi-langue, alias)
// ============================================================
// Un manhwa peut avoir plusieurs titres : original (KR/JP/CN),
// traduction EN, traduction FR, alias communautaires, etc.
// manhwas.title reste le titre d'affichage principal (raccourci).

export const manhwaTitles = pgTable('manhwa_titles', {
  id: uuid('id').defaultRandom().primaryKey(),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  language: text('language'), // 'kr' | 'jp' | 'cn' | 'en' | 'fr' | null (alias)
  isPrimary: boolean('is_primary').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('manhwa_titles_manhwa_id_idx').on(table.manhwaId),
]);

// ============================================================
// AUTHORS — Auteurs / Artistes
// ============================================================

export const authors = pgTable('authors', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const manhwaAuthors = pgTable('manhwa_authors', {
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => authors.id, { onDelete: 'cascade' }),
  role: authorRoleEnum('role').default('both').notNull(),
}, (table) => [
  primaryKey({ columns: [table.manhwaId, table.authorId] }),
]);

// ============================================================
// GENRES — Genres (Action, Romance, etc.)
// ============================================================

export const genres = pgTable('genres', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  color: text('color'),
}, (table) => [
  uniqueIndex('genres_slug_idx').on(table.slug),
]);

export const manhwaGenres = pgTable('manhwa_genres', {
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  genreId: uuid('genre_id')
    .notNull()
    .references(() => genres.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.manhwaId, table.genreId] }),
]);

// ============================================================
// SOURCES — Sites de scantrad (Scan Manga, Asura, Phenix…)
// ============================================================

export const sources = pgTable('sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  language: text('language').default('fr').notNull(),
  iconUrl: text('icon_url'),
  isOfficial: boolean('is_official').default(false).notNull(),
  // Audit
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  deletedAt: timestamp('deleted_at'),
});

// Pivot table : Quels manhwas sont disponibles sur quels sites
export const manhwaSources = pgTable('manhwa_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  manhwaUrl: text('manhwa_url'), // URL de la page du manhwa sur cette source
  latestChapter: integer('latest_chapter'), // Dernier chapitre dispo sur cette source
  lastScrapedAt: timestamp('last_scraped_at'),
}, (table) => [
  uniqueIndex('manhwa_sources_unique_idx').on(table.manhwaId, table.sourceId),
]);

// ============================================================
// CHAPTERS — Chapitres individuels d'un manhwa
// ============================================================

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

// Pivot table : Un chapitre est disponible sur plusieurs sources
export const chapterSources = pgTable('chapter_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  url: text('url').notNull(), // Lien direct vers le chapitre
  quality: chapterQualityEnum('quality').default('hd').notNull(),
  language: text('language').default('fr').notNull(),
  scrapedAt: timestamp('scraped_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('chapter_sources_unique_idx').on(table.chapterId, table.sourceId, table.language),
]);

// ============================================================
// EXTERNAL LINKS — IDs AniList, MAL, MangaDex, Kitsu, etc.
// ============================================================

export const externalLinks = pgTable('external_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // 'anilist' | 'mal' | 'mangadex' | 'kitsu' | …
  externalId: text('external_id').notNull(), // L'ID sur la plateforme externe
  externalUrl: text('external_url'), // URL directe vers la fiche
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('external_links_unique_idx').on(table.manhwaId, table.provider),
  index('external_links_provider_idx').on(table.provider, table.externalId),
]);

// ============================================================
// MANHWA COVERS — Couvertures multiples par manhwa
// ============================================================

export const manhwaCovers = pgTable('manhwa_covers', {
  id: uuid('id').defaultRandom().primaryKey(),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url').notNull(),
  source: text('source'), // 'anilist' | 'mal' | 'custom' | 'scraped'
  isPrimary: boolean('is_primary').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================
// READING PROGRESS — Vue macro du suivi de lecture
// ============================================================
// Le user_id fait référence à la table `user` gérée par Better Auth.
// La FK sera ajoutée une fois Better Auth configuré.

export const readingProgress = pgTable('reading_progress', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  status: readingStatusEnum('status').default('plan_to_read').notNull(),
  currentChapter: integer('current_chapter').default(0).notNull(), // Dernier chapitre lu en date (par read_at le plus récent)
  furthestChapter: integer('furthest_chapter').default(0).notNull(), // MAX(chapter.number) jamais lu — progression maximale
  rating: integer('rating'), // Note personnelle 1-10
  notes: text('notes'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  // Audit
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  updatedBy: text('updated_by'),
}, (table) => [
  uniqueIndex('reading_progress_user_manhwa_idx').on(table.userId, table.manhwaId),
  index('reading_progress_user_id_idx').on(table.userId),
]);

// ============================================================
// CHAPTER READS — Journal de lecture granulaire (historisation complète)
// ============================================================
// Chaque ligne = une lecture (ou re-lecture) d'un chapitre.
// Plusieurs lignes pour le même (user_id, chapter_id) = re-lectures.
// reading_progress.current_chapter = numéro du chapitre avec le read_at le plus récent.
// reading_progress.furthest_chapter = MAX(chapter.number) de tous les chapter_reads.

export const chapterReads = pgTable('chapter_reads', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id')
    .references(() => sources.id, { onDelete: 'set null' }), // Nullable : peut avoir lu hors-ligne
  readAt: timestamp('read_at').defaultNow().notNull(),
  readingTimeSeconds: integer('reading_time_seconds'), // Optionnel, pour stats futures
}, (table) => [
  index('chapter_reads_user_id_idx').on(table.userId),
  index('chapter_reads_chapter_id_idx').on(table.chapterId),
  index('chapter_reads_read_at_idx').on(table.userId, table.readAt),
]);

// ============================================================
// READING LISTS — Listes personnalisées (Favoris, Top Tier…)
// ============================================================

export const readingLists = pgTable('reading_lists', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0).notNull(),
  // Audit
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('reading_lists_user_id_idx').on(table.userId),
]);

export const readingListItems = pgTable('reading_list_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  listId: uuid('list_id')
    .notNull()
    .references(() => readingLists.id, { onDelete: 'cascade' }),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').default(0).notNull(),
  addedAt: timestamp('added_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('reading_list_items_unique_idx').on(table.listId, table.manhwaId),
]);

// ============================================================
// AUDIT LOGS — Journal centralisé de toutes les actions
// ============================================================
// Chaque mutation (create/update/delete) sur une entité crée une entrée.
// Le champ `changes` stocke le diff JSON { field: { old, new } }.
// Rempli automatiquement par un middleware Hono, jamais manuellement.

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id'), // Nullable : actions système (scraper, enrichissement)
  action: auditActionEnum('action').notNull(),
  entityType: text('entity_type').notNull(), // 'manhwa' | 'chapter' | 'source' | 'reading_progress' | …
  entityId: text('entity_id').notNull(), // UUID de l'entité modifiée (text pour flexibilité)
  changes: text('changes'), // JSON stringifié : { "title": { "old": "X", "new": "Y" } }
  metadata: text('metadata'), // JSON optionnel : { ip, user_agent, ... }
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('audit_logs_entity_idx').on(table.entityType, table.entityId),
  index('audit_logs_user_id_idx').on(table.userId),
  index('audit_logs_created_at_idx').on(table.createdAt),
]);

// ============================================================
// RELATIONS (Drizzle relational query API)
// ============================================================

export const manhwasRelations = relations(manhwas, ({ many }) => ({
  titles: many(manhwaTitles),
  authors: many(manhwaAuthors),
  genres: many(manhwaGenres),
  chapters: many(chapters),
  sources: many(manhwaSources),
  covers: many(manhwaCovers),
  externalLinks: many(externalLinks),
  readingProgress: many(readingProgress),
  readingListItems: many(readingListItems),
}));

export const manhwaTitlesRelations = relations(manhwaTitles, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwaTitles.manhwaId],
    references: [manhwas.id],
  }),
}));

export const authorsRelations = relations(authors, ({ many }) => ({
  manhwas: many(manhwaAuthors),
}));

export const manhwaAuthorsRelations = relations(manhwaAuthors, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwaAuthors.manhwaId],
    references: [manhwas.id],
  }),
  author: one(authors, {
    fields: [manhwaAuthors.authorId],
    references: [authors.id],
  }),
}));

export const genresRelations = relations(genres, ({ many }) => ({
  manhwas: many(manhwaGenres),
}));

export const manhwaGenresRelations = relations(manhwaGenres, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwaGenres.manhwaId],
    references: [manhwas.id],
  }),
  genre: one(genres, {
    fields: [manhwaGenres.genreId],
    references: [genres.id],
  }),
}));

export const sourcesRelations = relations(sources, ({ many }) => ({
  manhwas: many(manhwaSources),
  chapterSources: many(chapterSources),
  chapterReads: many(chapterReads),
}));

export const manhwaSourcesRelations = relations(manhwaSources, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwaSources.manhwaId],
    references: [manhwas.id],
  }),
  source: one(sources, {
    fields: [manhwaSources.sourceId],
    references: [sources.id],
  }),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  manhwa: one(manhwas, {
    fields: [chapters.manhwaId],
    references: [manhwas.id],
  }),
  sources: many(chapterSources),
  reads: many(chapterReads),
}));

export const chapterSourcesRelations = relations(chapterSources, ({ one }) => ({
  chapter: one(chapters, {
    fields: [chapterSources.chapterId],
    references: [chapters.id],
  }),
  source: one(sources, {
    fields: [chapterSources.sourceId],
    references: [sources.id],
  }),
}));

export const externalLinksRelations = relations(externalLinks, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [externalLinks.manhwaId],
    references: [manhwas.id],
  }),
}));

export const manhwaCoversRelations = relations(manhwaCovers, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwaCovers.manhwaId],
    references: [manhwas.id],
  }),
}));

export const readingProgressRelations = relations(readingProgress, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [readingProgress.manhwaId],
    references: [manhwas.id],
  }),
}));

export const chapterReadsRelations = relations(chapterReads, ({ one }) => ({
  chapter: one(chapters, {
    fields: [chapterReads.chapterId],
    references: [chapters.id],
  }),
  source: one(sources, {
    fields: [chapterReads.sourceId],
    references: [sources.id],
  }),
}));

export const readingListsRelations = relations(readingLists, ({ many }) => ({
  items: many(readingListItems),
}));

export const readingListItemsRelations = relations(readingListItems, ({ one }) => ({
  list: one(readingLists, {
    fields: [readingListItems.listId],
    references: [readingLists.id],
  }),
  manhwa: one(manhwas, {
    fields: [readingListItems.manhwaId],
    references: [manhwas.id],
  }),
}));