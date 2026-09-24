CREATE TYPE "public"."chapter_kind" AS ENUM('regular', 'extra', 'side_story', 'prologue', 'epilogue', 'notice');--> statement-breakpoint
CREATE TYPE "public"."scrape_run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_health_status" AS ENUM('up', 'degraded', 'blocked', 'down');--> statement-breakpoint
CREATE TYPE "public"."term_source" AS ENUM('curated', 'scraper', 'external');--> statement-breakpoint
CREATE TABLE "chapter_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"scanlation_group_id" uuid,
	"url" text NOT NULL,
	"language" text DEFAULT 'fr' NOT NULL,
	"quality" "chapter_quality" DEFAULT 'hd' NOT NULL,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingestion_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"source_id" uuid NOT NULL,
	"scrape_run_id" uuid,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manhwa_terms" (
	"manhwa_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"relevance" smallint DEFAULT 100 NOT NULL,
	"is_spoiler" boolean DEFAULT false NOT NULL,
	"source" "term_source" DEFAULT 'curated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manhwa_terms_manhwa_id_term_id_pk" PRIMARY KEY("manhwa_id","term_id"),
	CONSTRAINT "manhwa_terms_relevance_range" CHECK ("manhwa_terms"."relevance" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "scanlation_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "scrape_run_status" DEFAULT 'running' NOT NULL,
	"worker_version" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stats" jsonb,
	"error" text,
	CONSTRAINT "scrape_runs_finished_after_start" CHECK ("scrape_runs"."finished_at" IS NULL OR "scrape_runs"."finished_at" >= "scrape_runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"scrape_run_id" uuid,
	"status" "source_health_status" NOT NULL,
	"http_status" smallint,
	"latency_ms" integer,
	"blocked_by" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_health_latency_positive" CHECK ("source_health"."latency_ms" IS NULL OR "source_health"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "term_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"language" text
);
--> statement-breakpoint
CREATE TABLE "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_parent_not_self" CHECK ("terms"."parent_id" IS NULL OR "terms"."parent_id" <> "terms"."id")
);
--> statement-breakpoint
CREATE TABLE "vocabularies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_hierarchical" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "manhwa_covers_manhwa_id_idx";--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "kind" "chapter_kind" DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_releases" ADD CONSTRAINT "chapter_releases_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_releases" ADD CONSTRAINT "chapter_releases_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_releases" ADD CONSTRAINT "chapter_releases_scanlation_group_id_scanlation_groups_id_fk" FOREIGN KEY ("scanlation_group_id") REFERENCES "public"."scanlation_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_batches" ADD CONSTRAINT "ingestion_batches_scrape_run_id_scrape_runs_id_fk" FOREIGN KEY ("scrape_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_terms" ADD CONSTRAINT "manhwa_terms_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_terms" ADD CONSTRAINT "manhwa_terms_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_health" ADD CONSTRAINT "source_health_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_health" ADD CONSTRAINT "source_health_scrape_run_id_scrape_runs_id_fk" FOREIGN KEY ("scrape_run_id") REFERENCES "public"."scrape_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_aliases" ADD CONSTRAINT "term_aliases_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_vocabulary_id_vocabularies_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_parent_id_terms_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_releases_source_url_idx" ON "chapter_releases" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "chapter_releases_chapter_id_idx" ON "chapter_releases" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_releases_scanlation_group_id_idx" ON "chapter_releases" USING btree ("scanlation_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ingestion_batches_idempotency_key_idx" ON "ingestion_batches" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ingestion_batches_scrape_run_id_idx" ON "ingestion_batches" USING btree ("scrape_run_id");--> statement-breakpoint
CREATE INDEX "manhwa_terms_term_id_idx" ON "manhwa_terms" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scanlation_groups_slug_idx" ON "scanlation_groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "scrape_runs_source_started_idx" ON "scrape_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "source_health_source_checked_idx" ON "source_health" USING btree ("source_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "term_aliases_term_alias_idx" ON "term_aliases" USING btree ("term_id",lower("alias"));--> statement-breakpoint
CREATE INDEX "term_aliases_alias_idx" ON "term_aliases" USING btree (lower("alias"));--> statement-breakpoint
CREATE UNIQUE INDEX "terms_vocabulary_slug_idx" ON "terms" USING btree ("vocabulary_id","slug");--> statement-breakpoint
CREATE INDEX "terms_parent_id_idx" ON "terms" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vocabularies_slug_idx" ON "vocabularies" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "manhwa_covers_manhwa_image_idx" ON "manhwa_covers" USING btree ("manhwa_id","image_url");--> statement-breakpoint
CREATE UNIQUE INDEX "manhwa_sources_source_url_idx" ON "manhwa_sources" USING btree ("source_id","manhwa_url") WHERE "manhwa_sources"."manhwa_url" IS NOT NULL;