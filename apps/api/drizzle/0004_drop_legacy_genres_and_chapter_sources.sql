-- Reprise des données avant suppression des tables historiques (ajout manuel, idempotent).
-- 1. Les anciens genres deviennent les termes du vocabulaire hiérarchique « genre ».
INSERT INTO "vocabularies" ("slug", "name", "is_hierarchical") VALUES ('genre', 'Genres', true) ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "terms" ("vocabulary_id", "slug", "name", "color")
SELECT v."id", g."slug", g."name", g."color" FROM "genres" g CROSS JOIN "vocabularies" v WHERE v."slug" = 'genre'
ON CONFLICT ("vocabulary_id", "slug") DO NOTHING;--> statement-breakpoint
INSERT INTO "manhwa_terms" ("manhwa_id", "term_id", "source")
SELECT mg."manhwa_id", t."id", 'curated' FROM "manhwa_genres" mg
JOIN "genres" g ON g."id" = mg."genre_id"
JOIN "vocabularies" v ON v."slug" = 'genre'
JOIN "terms" t ON t."vocabulary_id" = v."id" AND t."slug" = g."slug"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- 2. Les liens chapitre ↔ source deviennent des parutions.
INSERT INTO "chapter_releases" ("chapter_id", "source_id", "url", "language", "quality", "first_seen_at", "last_seen_at")
SELECT "chapter_id", "source_id", "url", "language", "quality", "scraped_at", "scraped_at" FROM "chapter_sources"
ON CONFLICT ("source_id", "url") DO NOTHING;--> statement-breakpoint
DROP TABLE "chapter_sources" CASCADE;--> statement-breakpoint
DROP TABLE "genres" CASCADE;--> statement-breakpoint
DROP TABLE "manhwa_genres" CASCADE;