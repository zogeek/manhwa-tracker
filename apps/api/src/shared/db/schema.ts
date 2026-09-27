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
  numeric,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  check,
  smallint,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { user } from './auth-schema.js';

// Tables Better Auth (user, session, account, verification) : générées par `pnpm auth:generate`,
// ne jamais les modifier à la main.
export * from './auth-schema.js';

// ============================================================
// COLUMN HELPERS
// ============================================================
// Toutes les dates sont stockées en `timestamptz` (UTC côté Postgres, Date côté JS).
// Les numéros de chapitre sont des `numeric(8,2)` : 0 (prologue), 10.5 (chapitre bonus), etc.

const timestamptz = <TName extends string>(name: TName) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

const chapterNumber = <TName extends string>(name: TName) =>
  numeric(name, { precision: 8, scale: 2, mode: 'number' });

const createdAt = () => timestamptz('created_at').defaultNow().notNull();

const updatedAt = () =>
  timestamptz('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

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

export const chapterKindEnum = pgEnum('chapter_kind', [
  'regular',
  'extra',
  'side_story',
  'prologue',
  'epilogue',
  'notice', // annonce de pause, de fin de saison…
]);

export const termSourceEnum = pgEnum('term_source', [
  'curated', // posé par un admin
  'scraper', // déduit par le worker Python
  'external', // importé d'une base externe (AniList, MAL…)
]);

export const scrapeRunStatusEnum = pgEnum('scrape_run_status', [
  'running',
  'succeeded',
  'partial', // terminé avec des erreurs sur une partie des éléments
  'failed',
]);

export const sourceHealthStatusEnum = pgEnum('source_health_status', [
  'up',
  'degraded', // lent ou erreurs intermittentes
  'blocked', // anti-bot (Cloudflare, Datadome…)
  'down',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'pending', // en attente (éventuellement différé par `run_at` : ré-essai)
  'running', // réservé par un worker (`locked_by`, `locked_at`)
  'succeeded',
  'failed', // abandonné : erreur définitive ou ré-essais épuisés (dead-letter)
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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: text('created_by'), // user_id Better Auth
  updatedBy: text('updated_by'), // user_id Better Auth
  deletedAt: timestamptz('deleted_at'), // null = actif, sinon soft-deleted
}, (table) => [
  // Recherche floue (pg_trgm, migration 0005) : index GIN trigrammes, limités aux fiches actives.
  // Servent les opérateurs `<%` (word_similarity) et `ILIKE '%…%'` de la recherche du catalogue.
  index('manhwas_title_trgm_idx')
    .using('gin', table.title.op('gin_trgm_ops'))
    .where(sql`${table.deletedAt} IS NULL`),
  index('manhwas_original_title_trgm_idx')
    .using('gin', table.originalTitle.op('gin_trgm_ops'))
    .where(sql`${table.deletedAt} IS NULL`),
  check('manhwas_rating_range', sql`${table.rating} IS NULL OR (${table.rating} >= 0 AND ${table.rating} <= 10)`),
  check('manhwas_total_chapters_positive', sql`${table.totalChapters} IS NULL OR ${table.totalChapters} >= 0`),
]);

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
  createdAt: createdAt(),
}, (table) => [
  index('manhwa_titles_manhwa_id_idx').on(table.manhwaId),
  // Titres alternatifs / alias : même recherche floue que manhwas.title.
  index('manhwa_titles_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops')),
  // Un seul titre principal par manhwa
  uniqueIndex('manhwa_titles_one_primary_idx').on(table.manhwaId).where(sql`${table.isPrimary}`),
]);

// ============================================================
// AUTHORS — Auteurs / Artistes
// ============================================================

export const authors = pgTable('authors', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(), // nom latin affiché (« Chugong »)
  nativeName: text('native_name'), // nom d'origine (« 추공 ») : la clé la plus fiable entre catalogues
  // Clé de rapprochement dérivée de l'identité (nom natif, sinon nom latin normalisé) : la même
  // personne importée d'AniList puis de MangaDex n'est enregistrée qu'une fois.
  slug: text('slug').notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('authors_slug_idx').on(table.slug),
]);

export const manhwaAuthors = pgTable('manhwa_authors', {
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id')
    .notNull()
    .references(() => authors.id, { onDelete: 'cascade' }),
  role: authorRoleEnum('role').default('both').notNull(),
  // Ordre d'affichage (0 = auteur principal), tel que fourni par le catalogue d'origine.
  position: smallint('position').default(0).notNull(),
}, (table) => [
  primaryKey({ columns: [table.manhwaId, table.authorId] }),
  index('manhwa_authors_author_id_idx').on(table.authorId),
  check('manhwa_authors_position_positive', sql`${table.position} >= 0`),
]);

// ============================================================
// TAXONOMIE — Vocabulaires et termes hiérarchiques
// ============================================================
// Remplace les anciens `genres` : un vocabulaire (genre, thème, démographie, avertissement…)
// contient des termes organisés en arbre (parent_id). Les alias permettent au scraper de
// rattacher « Isekai », « isekai » ou « 異世界 » au même terme.

export const vocabularies = pgTable('vocabularies', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(), // 'genre' | 'theme' | 'demographic' | 'content_warning' | 'format' …
  name: text('name').notNull(),
  description: text('description'),
  isHierarchical: boolean('is_hierarchical').default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('vocabularies_slug_idx').on(table.slug),
]);

export const terms = pgTable('terms', {
  id: uuid('id').defaultRandom().primaryKey(),
  vocabularyId: uuid('vocabulary_id')
    .notNull()
    .references(() => vocabularies.id, { onDelete: 'cascade' }),
  // RESTRICT : on ne supprime pas un terme qui a encore des enfants (réponse 409).
  parentId: uuid('parent_id').references((): AnyPgColumn => terms.id, { onDelete: 'restrict' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('terms_vocabulary_slug_idx').on(table.vocabularyId, table.slug),
  index('terms_parent_id_idx').on(table.parentId),
  check('terms_parent_not_self', sql`${table.parentId} IS NULL OR ${table.parentId} <> ${table.id}`),
]);

export const termAliases = pgTable('term_aliases', {
  id: uuid('id').defaultRandom().primaryKey(),
  termId: uuid('term_id')
    .notNull()
    .references(() => terms.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  language: text('language'), // null = indépendant de la langue
}, (table) => [
  // Recherche insensible à la casse : un alias ne désigne qu'un seul terme par vocabulaire (vérifié côté service).
  uniqueIndex('term_aliases_term_alias_idx').on(table.termId, sql`lower(${table.alias})`),
  index('term_aliases_alias_idx').on(sql`lower(${table.alias})`),
]);

export const manhwaTerms = pgTable('manhwa_terms', {
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  termId: uuid('term_id')
    .notNull()
    .references(() => terms.id, { onDelete: 'cascade' }),
  relevance: smallint('relevance').default(100).notNull(), // 0-100 : poids du tag pour cette œuvre
  isSpoiler: boolean('is_spoiler').default(false).notNull(),
  source: termSourceEnum('source').default('curated').notNull(),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.manhwaId, table.termId] }),
  index('manhwa_terms_term_id_idx').on(table.termId),
  check('manhwa_terms_relevance_range', sql`${table.relevance} BETWEEN 0 AND 100`),
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
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  deletedAt: timestamptz('deleted_at'),
}, (table) => [
  // Unicité uniquement parmi les sources actives : une source soft-deleted peut être recréée.
  uniqueIndex('sources_base_url_active_idx').on(table.baseUrl).where(sql`${table.deletedAt} IS NULL`),
]);

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
  latestChapter: chapterNumber('latest_chapter'), // Dernier chapitre dispo sur cette source
  lastScrapedAt: timestamptz('last_scraped_at'),
}, (table) => [
  uniqueIndex('manhwa_sources_unique_idx').on(table.manhwaId, table.sourceId),
  // Identité d'une œuvre sur une source : clé de rapprochement utilisée par l'ingestion.
  uniqueIndex('manhwa_sources_source_url_idx')
    .on(table.sourceId, table.manhwaUrl)
    .where(sql`${table.manhwaUrl} IS NOT NULL`),
  // Index non partiel : requis pour le ON DELETE CASCADE depuis sources.
  index('manhwa_sources_source_id_idx').on(table.sourceId),
]);

// ============================================================
// CHAPTERS — Chapitres individuels d'un manhwa
// ============================================================

export const chapters = pgTable('chapters', {
  id: uuid('id').defaultRandom().primaryKey(),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  number: chapterNumber('number').notNull(),
  kind: chapterKindEnum('kind').default('regular').notNull(),
  title: text('title'),
  releaseDate: date('release_date'),
  // Audit
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  deletedAt: timestamptz('deleted_at'),
}, (table) => [
  check('chapters_number_positive', sql`${table.number} >= 0`),
  // Unicité parmi les chapitres actifs : un chapitre soft-deleted peut être recréé.
  uniqueIndex('chapters_manhwa_number_active_idx')
    .on(table.manhwaId, table.number)
    .where(sql`${table.deletedAt} IS NULL`),
  // Index non partiel : requis pour le ON DELETE CASCADE depuis manhwas.
  index('chapters_manhwa_id_idx').on(table.manhwaId),
]);

// ============================================================
// SCANLATION GROUPS — Équipes de traduction
// ============================================================

export const scanlationGroups = pgTable('scanlation_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(), // nom normalisé : clé de rapprochement quand aucun identifiant n'est connu (scraper)
  name: text('name').notNull(),
  websiteUrl: text('website_url'),
  // Identité chez le fournisseur qui a fait connaître la team (ex. UUID du groupe MangaDex) :
  // plus fiable que le nom, qui peut changer (« Asura Scans » → « Asura Comics »).
  provider: text('provider'),
  externalId: text('external_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex('scanlation_groups_slug_idx').on(table.slug),
  uniqueIndex('scanlation_groups_provider_external_id_idx')
    .on(table.provider, table.externalId)
    .where(sql`${table.externalId} IS NOT NULL`),
  check(
    'scanlation_groups_external_id_has_provider',
    sql`(${table.provider} IS NULL) = (${table.externalId} IS NULL)`,
  ),
]);

// ============================================================
// CHAPTER RELEASES — Parutions concrètes d'un chapitre canonique
// ============================================================
// `chapters` = le chapitre en tant qu'œuvre (numéro 42 de Solo Leveling).
// `chapter_releases` = une mise en ligne précise : telle source, telle langue, telle équipe,
// telle URL. Un même chapitre a donc N parutions. L'URL identifie la parution sur sa source
// (clé d'upsert idempotente pour le scraper).

export const chapterReleases = pgTable('chapter_releases', {
  id: uuid('id').defaultRandom().primaryKey(),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  language: text('language').default('fr').notNull(),
  quality: chapterQualityEnum('quality').default('hd').notNull(),
  publishedAt: timestamptz('published_at'), // date annoncée par la source
  firstSeenAt: timestamptz('first_seen_at').defaultNow().notNull(), // première détection par le scraper
  lastSeenAt: timestamptz('last_seen_at').defaultNow().notNull(), // dernière détection (preuve de vie)
  removedAt: timestamptz('removed_at'), // disparue de la source (DMCA, retrait…)
}, (table) => [
  uniqueIndex('chapter_releases_source_url_idx').on(table.sourceId, table.url),
  index('chapter_releases_chapter_id_idx').on(table.chapterId),
]);

// Pivot : une parution peut être le fruit d'une collaboration entre plusieurs teams
// (MangaDex liste alors plusieurs `scanlation_group` sur le même chapitre).
export const chapterReleaseGroups = pgTable('chapter_release_groups', {
  releaseId: uuid('release_id')
    .notNull()
    .references(() => chapterReleases.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id')
    .notNull()
    .references(() => scanlationGroups.id, { onDelete: 'cascade' }),
  // Ordre de crédit tel que donné par la source (0 = team principale).
  position: smallint('position').default(0).notNull(),
}, (table) => [
  primaryKey({ columns: [table.releaseId, table.groupId] }),
  // Index non couvert par la clé primaire : « toutes les parutions d'Asura Scans » + cascade depuis scanlation_groups.
  index('chapter_release_groups_group_id_idx').on(table.groupId),
  check('chapter_release_groups_position_positive', sql`${table.position} >= 0`),
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
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('external_links_unique_idx').on(table.manhwaId, table.provider),
  // Une fiche externe (ex. AniList #30013) n'est rattachée qu'à un seul manhwa : garantit l'import idempotent.
  uniqueIndex('external_links_provider_external_id_idx').on(table.provider, table.externalId),
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
  // Copie locale (job `cover.mirror`) : clé adressée par contenu (`<sha256>.<ext>`), servie par /images/media/:key.
  storageKey: text('storage_key'),
  mirroredAt: timestamptz('mirrored_at'),
  createdAt: createdAt(),
}, (table) => [
  // Une même image n'est enregistrée qu'une fois par manhwa (upsert idempotent de l'ingestion).
  uniqueIndex('manhwa_covers_manhwa_image_idx').on(table.manhwaId, table.imageUrl),
  // Une seule couverture principale par manhwa
  uniqueIndex('manhwa_covers_one_primary_idx').on(table.manhwaId).where(sql`${table.isPrimary}`),
]);

// ============================================================
// READING PROGRESS — Vue macro du suivi de lecture
// ============================================================
// Le user_id fait référence à la table `user` gérée par Better Auth.

export const readingProgress = pgTable('reading_progress', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  manhwaId: uuid('manhwa_id')
    .notNull()
    .references(() => manhwas.id, { onDelete: 'cascade' }),
  status: readingStatusEnum('status').default('plan_to_read').notNull(),
  currentChapter: chapterNumber('current_chapter').default(0).notNull(), // Dernier chapitre lu en date (par read_at le plus récent)
  furthestChapter: chapterNumber('furthest_chapter').default(0).notNull(), // MAX(chapter.number) jamais lu — progression maximale
  rating: integer('rating'), // Note personnelle 1-10
  notes: text('notes'),
  startedAt: timestamptz('started_at'),
  completedAt: timestamptz('completed_at'),
  // Audit
  updatedAt: updatedAt(),
  updatedBy: text('updated_by'),
}, (table) => [
  // Couvre aussi les requêtes filtrées sur user_id seul (préfixe de l'index).
  uniqueIndex('reading_progress_user_manhwa_idx').on(table.userId, table.manhwaId),
  index('reading_progress_manhwa_id_idx').on(table.manhwaId),
  check('reading_progress_rating_range', sql`${table.rating} IS NULL OR (${table.rating} >= 1 AND ${table.rating} <= 10)`),
  check('reading_progress_chapters_positive', sql`${table.currentChapter} >= 0 AND ${table.furthestChapter} >= 0`),
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
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  sourceId: uuid('source_id')
    .references(() => sources.id, { onDelete: 'set null' }), // Nullable : peut avoir lu hors-ligne
  readAt: timestamptz('read_at').defaultNow().notNull(),
  readingTimeSeconds: integer('reading_time_seconds'), // Optionnel, pour stats futures
}, (table) => [
  // Couvre aussi les requêtes filtrées sur user_id seul (préfixe de l'index).
  index('chapter_reads_user_read_at_idx').on(table.userId, table.readAt),
  index('chapter_reads_chapter_id_idx').on(table.chapterId),
  index('chapter_reads_source_id_idx').on(table.sourceId),
  check('chapter_reads_reading_time_positive', sql`${table.readingTimeSeconds} IS NULL OR ${table.readingTimeSeconds} >= 0`),
]);

// ============================================================
// READING LISTS — Listes personnalisées (Favoris, Top Tier…)
// ============================================================

export const readingLists = pgTable('reading_lists', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0).notNull(),
  // Audit
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: timestamptz('deleted_at'),
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
  addedAt: timestamptz('added_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('reading_list_items_unique_idx').on(table.listId, table.manhwaId),
  index('reading_list_items_manhwa_id_idx').on(table.manhwaId),
]);

// ============================================================
// SCRAPER — Télémétrie des exécutions et santé des sources
// ============================================================

export type ScrapeRunStats = {
  manhwasSeen?: number;
  chaptersSeen?: number;
  releasesCreated?: number;
  errors?: number;
  [key: string]: number | undefined;
};

export const scrapeRuns = pgTable('scrape_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  status: scrapeRunStatusEnum('status').default('running').notNull(),
  workerVersion: text('worker_version'),
  startedAt: timestamptz('started_at').defaultNow().notNull(),
  finishedAt: timestamptz('finished_at'),
  stats: jsonb('stats').$type<ScrapeRunStats>(),
  error: text('error'),
}, (table) => [
  index('scrape_runs_source_started_idx').on(table.sourceId, table.startedAt),
  check('scrape_runs_finished_after_start', sql`${table.finishedAt} IS NULL OR ${table.finishedAt} >= ${table.startedAt}`),
]);

// Série temporelle : un échantillon par vérification d'une source.
export const sourceHealth = pgTable('source_health', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  scrapeRunId: uuid('scrape_run_id').references(() => scrapeRuns.id, { onDelete: 'set null' }),
  status: sourceHealthStatusEnum('status').notNull(),
  httpStatus: smallint('http_status'),
  latencyMs: integer('latency_ms'),
  blockedBy: text('blocked_by'), // 'cloudflare' | 'datadome' | …
  checkedAt: timestamptz('checked_at').defaultNow().notNull(),
}, (table) => [
  index('source_health_source_checked_idx').on(table.sourceId, table.checkedAt),
  check('source_health_latency_positive', sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`),
]);

// ============================================================
// INGESTION — Journal d'idempotence des lots envoyés par le scraper
// ============================================================
// Chaque lot porte une clé d'idempotence (header `Idempotency-Key`). Rejouer la même clé
// renvoie le résultat enregistré au lieu de retraiter le lot ; la même clé avec un contenu
// différent est refusée (409).

export type IngestionBatchResult = {
  manhwas: { sourceManhwaUrl: string; manhwaId: string; created: boolean }[];
  chaptersCreated: number;
  releasesCreated: number;
  releasesUpdated: number;
  coversAdded: number;
};

export const ingestionBatches = pgTable('ingestion_batches', {
  id: uuid('id').defaultRandom().primaryKey(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(), // SHA-256 du lot validé
  sourceId: uuid('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  scrapeRunId: uuid('scrape_run_id').references(() => scrapeRuns.id, { onDelete: 'set null' }),
  result: jsonb('result').$type<IngestionBatchResult>().notNull(),
  receivedAt: createdAt(),
}, (table) => [
  uniqueIndex('ingestion_batches_idempotency_key_idx').on(table.idempotencyKey),
  index('ingestion_batches_scrape_run_id_idx').on(table.scrapeRunId),
]);

// ============================================================
// JOBS — File de tâches asynchrones (outbox transactionnelle)
// ============================================================
// Une tâche est insérée dans la MÊME transaction que l'écriture métier qui la déclenche
// (ex. import d'une œuvre → miroir de la couverture) : soit les deux existent, soit aucun.
// Les workers la réservent avec `SELECT … FOR UPDATE SKIP LOCKED` : plusieurs workers
// (ou plusieurs instances de l'API) se partagent la file sans jamais traiter deux fois la même tâche.

export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(), // 'cover.mirror' | 'chapters.sync' | … (payload validé par son handler)
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  status: jobStatusEnum('status').default('pending').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  runAt: timestamptz('run_at').defaultNow().notNull(), // pas avant cette date (ré-essai différé)
  lockedAt: timestamptz('locked_at'),
  lockedBy: text('locked_by'), // identifiant du worker propriétaire de la réservation
  lastError: text('last_error'),
  // Évite d'empiler deux fois la même tâche tant qu'elle n'est pas terminée (ex. `chapters.sync:<manhwaId>`).
  dedupeKey: text('dedupe_key'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  finishedAt: timestamptz('finished_at'),
}, (table) => [
  // Index de dépilage : uniquement les tâches en attente, triées par échéance.
  index('jobs_pending_run_at_idx').on(table.runAt).where(sql`${table.status} = 'pending'`),
  // Récupération des réservations expirées (worker mort en cours de tâche).
  index('jobs_running_locked_at_idx').on(table.lockedAt).where(sql`${table.status} = 'running'`),
  uniqueIndex('jobs_dedupe_key_active_idx')
    .on(table.dedupeKey)
    .where(sql`${table.dedupeKey} IS NOT NULL AND ${table.status} IN ('pending', 'running')`),
  check('jobs_attempts_positive', sql`${table.attempts} >= 0`),
  check('jobs_max_attempts_positive', sql`${table.maxAttempts} >= 1`),
]);

// ============================================================
// AUDIT LOGS — Journal centralisé de toutes les actions
// ============================================================
// Chaque mutation (create/update/delete) sur une entité crée une entrée.
// Le champ `changes` stocke le diff JSON { field: { old, new } }.
// Rempli automatiquement par un middleware Hono, jamais manuellement.

export type AuditChanges = Record<string, { old: unknown; new: unknown }>;

export type AuditMetadata = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
  [key: string]: unknown;
};

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id'), // Nullable : actions système (scraper, enrichissement)
  action: auditActionEnum('action').notNull(),
  entityType: text('entity_type').notNull(), // 'manhwa' | 'chapter' | 'source' | 'reading_progress' | …
  entityId: text('entity_id').notNull(), // UUID de l'entité modifiée (text pour flexibilité)
  changes: jsonb('changes').$type<AuditChanges>(),
  metadata: jsonb('metadata').$type<AuditMetadata>(),
  createdAt: createdAt(),
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
  terms: many(manhwaTerms),
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

export const vocabulariesRelations = relations(vocabularies, ({ many }) => ({
  terms: many(terms),
}));

export const termsRelations = relations(terms, ({ one, many }) => ({
  vocabulary: one(vocabularies, {
    fields: [terms.vocabularyId],
    references: [vocabularies.id],
  }),
  parent: one(terms, {
    fields: [terms.parentId],
    references: [terms.id],
    relationName: 'term_hierarchy',
  }),
  children: many(terms, { relationName: 'term_hierarchy' }),
  aliases: many(termAliases),
  manhwas: many(manhwaTerms),
}));

export const termAliasesRelations = relations(termAliases, ({ one }) => ({
  term: one(terms, {
    fields: [termAliases.termId],
    references: [terms.id],
  }),
}));

export const manhwaTermsRelations = relations(manhwaTerms, ({ one }) => ({
  manhwa: one(manhwas, {
    fields: [manhwaTerms.manhwaId],
    references: [manhwas.id],
  }),
  term: one(terms, {
    fields: [manhwaTerms.termId],
    references: [terms.id],
  }),
}));

export const sourcesRelations = relations(sources, ({ many }) => ({
  manhwas: many(manhwaSources),
  chapterReleases: many(chapterReleases),
  chapterReads: many(chapterReads),
  scrapeRuns: many(scrapeRuns),
  health: many(sourceHealth),
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
  releases: many(chapterReleases),
  reads: many(chapterReads),
}));

export const scanlationGroupsRelations = relations(scanlationGroups, ({ many }) => ({
  releases: many(chapterReleaseGroups),
}));

export const chapterReleaseGroupsRelations = relations(chapterReleaseGroups, ({ one }) => ({
  release: one(chapterReleases, {
    fields: [chapterReleaseGroups.releaseId],
    references: [chapterReleases.id],
  }),
  group: one(scanlationGroups, {
    fields: [chapterReleaseGroups.groupId],
    references: [scanlationGroups.id],
  }),
}));

export const chapterReleasesRelations = relations(chapterReleases, ({ one, many }) => ({
  chapter: one(chapters, {
    fields: [chapterReleases.chapterId],
    references: [chapters.id],
  }),
  source: one(sources, {
    fields: [chapterReleases.sourceId],
    references: [sources.id],
  }),
  groups: many(chapterReleaseGroups),
}));

export const scrapeRunsRelations = relations(scrapeRuns, ({ one, many }) => ({
  source: one(sources, {
    fields: [scrapeRuns.sourceId],
    references: [sources.id],
  }),
  health: many(sourceHealth),
  batches: many(ingestionBatches),
}));

export const sourceHealthRelations = relations(sourceHealth, ({ one }) => ({
  source: one(sources, {
    fields: [sourceHealth.sourceId],
    references: [sources.id],
  }),
  scrapeRun: one(scrapeRuns, {
    fields: [sourceHealth.scrapeRunId],
    references: [scrapeRuns.id],
  }),
}));

export const ingestionBatchesRelations = relations(ingestionBatches, ({ one }) => ({
  source: one(sources, {
    fields: [ingestionBatches.sourceId],
    references: [sources.id],
  }),
  scrapeRun: one(scrapeRuns, {
    fields: [ingestionBatches.scrapeRunId],
    references: [scrapeRuns.id],
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
  user: one(user, {
    fields: [readingProgress.userId],
    references: [user.id],
  }),
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

export const readingListsRelations = relations(readingLists, ({ one, many }) => ({
  user: one(user, {
    fields: [readingLists.userId],
    references: [user.id],
  }),
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
