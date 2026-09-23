CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."author_role" AS ENUM('story', 'art', 'both');--> statement-breakpoint
CREATE TYPE "public"."chapter_quality" AS ENUM('hd', 'sd', 'raw');--> statement-breakpoint
CREATE TYPE "public"."manhwa_status" AS ENUM('ongoing', 'completed', 'hiatus', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."manhwa_type" AS ENUM('manga', 'manhwa', 'manhua', 'webtoon');--> statement-breakpoint
CREATE TYPE "public"."reading_status" AS ENUM('reading', 'completed', 'on_hold', 'dropped', 'plan_to_read');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"changes" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"chapter_id" uuid NOT NULL,
	"source_id" uuid,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reading_time_seconds" integer,
	CONSTRAINT "chapter_reads_reading_time_positive" CHECK ("chapter_reads"."reading_time_seconds" IS NULL OR "chapter_reads"."reading_time_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chapter_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"quality" "chapter_quality" DEFAULT 'hd' NOT NULL,
	"language" text DEFAULT 'fr' NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manhwa_id" uuid NOT NULL,
	"number" numeric(8, 2) NOT NULL,
	"title" text,
	"release_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chapters_number_positive" CHECK ("chapters"."number" >= 0)
);
--> statement-breakpoint
CREATE TABLE "external_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manhwa_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text
);
--> statement-breakpoint
CREATE TABLE "manhwa_authors" (
	"manhwa_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"role" "author_role" DEFAULT 'both' NOT NULL,
	CONSTRAINT "manhwa_authors_manhwa_id_author_id_pk" PRIMARY KEY("manhwa_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "manhwa_covers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manhwa_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"source" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manhwa_genres" (
	"manhwa_id" uuid NOT NULL,
	"genre_id" uuid NOT NULL,
	CONSTRAINT "manhwa_genres_manhwa_id_genre_id_pk" PRIMARY KEY("manhwa_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "manhwa_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manhwa_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"manhwa_url" text,
	"latest_chapter" numeric(8, 2),
	"last_scraped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "manhwa_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manhwa_id" uuid NOT NULL,
	"title" text NOT NULL,
	"language" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manhwas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"synopsis" text,
	"cover_url" text,
	"type" "manhwa_type" DEFAULT 'manhwa' NOT NULL,
	"status" "manhwa_status" DEFAULT 'ongoing' NOT NULL,
	"country" text DEFAULT 'KR',
	"total_chapters" integer,
	"rating" real,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "manhwas_rating_range" CHECK ("manhwas"."rating" IS NULL OR ("manhwas"."rating" >= 0 AND "manhwas"."rating" <= 10)),
	CONSTRAINT "manhwas_total_chapters_positive" CHECK ("manhwas"."total_chapters" IS NULL OR "manhwas"."total_chapters" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reading_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"manhwa_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"manhwa_id" uuid NOT NULL,
	"status" "reading_status" DEFAULT 'plan_to_read' NOT NULL,
	"current_chapter" numeric(8, 2) DEFAULT 0 NOT NULL,
	"furthest_chapter" numeric(8, 2) DEFAULT 0 NOT NULL,
	"rating" integer,
	"notes" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "reading_progress_rating_range" CHECK ("reading_progress"."rating" IS NULL OR ("reading_progress"."rating" >= 1 AND "reading_progress"."rating" <= 10)),
	CONSTRAINT "reading_progress_chapters_positive" CHECK ("reading_progress"."current_chapter" >= 0 AND "reading_progress"."furthest_chapter" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"language" text DEFAULT 'fr' NOT NULL,
	"icon_url" text,
	"is_official" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chapter_reads" ADD CONSTRAINT "chapter_reads_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_reads" ADD CONSTRAINT "chapter_reads_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_sources" ADD CONSTRAINT "chapter_sources_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_sources" ADD CONSTRAINT "chapter_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_links" ADD CONSTRAINT "external_links_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_authors" ADD CONSTRAINT "manhwa_authors_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_authors" ADD CONSTRAINT "manhwa_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_covers" ADD CONSTRAINT "manhwa_covers_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_genres" ADD CONSTRAINT "manhwa_genres_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_genres" ADD CONSTRAINT "manhwa_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_sources" ADD CONSTRAINT "manhwa_sources_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_sources" ADD CONSTRAINT "manhwa_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manhwa_titles" ADD CONSTRAINT "manhwa_titles_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_list_items" ADD CONSTRAINT "reading_list_items_list_id_reading_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."reading_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_list_items" ADD CONSTRAINT "reading_list_items_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_manhwa_id_manhwas_id_fk" FOREIGN KEY ("manhwa_id") REFERENCES "public"."manhwas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chapter_reads_user_read_at_idx" ON "chapter_reads" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "chapter_reads_chapter_id_idx" ON "chapter_reads" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_reads_source_id_idx" ON "chapter_reads" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_sources_unique_idx" ON "chapter_sources" USING btree ("chapter_id","source_id","language");--> statement-breakpoint
CREATE INDEX "chapter_sources_source_id_idx" ON "chapter_sources" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_manhwa_number_active_idx" ON "chapters" USING btree ("manhwa_id","number") WHERE "chapters"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "chapters_manhwa_id_idx" ON "chapters" USING btree ("manhwa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_links_unique_idx" ON "external_links" USING btree ("manhwa_id","provider");--> statement-breakpoint
CREATE INDEX "external_links_provider_idx" ON "external_links" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "genres_slug_idx" ON "genres" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "manhwa_authors_author_id_idx" ON "manhwa_authors" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "manhwa_covers_manhwa_id_idx" ON "manhwa_covers" USING btree ("manhwa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manhwa_covers_one_primary_idx" ON "manhwa_covers" USING btree ("manhwa_id") WHERE "manhwa_covers"."is_primary";--> statement-breakpoint
CREATE INDEX "manhwa_genres_genre_id_idx" ON "manhwa_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manhwa_sources_unique_idx" ON "manhwa_sources" USING btree ("manhwa_id","source_id");--> statement-breakpoint
CREATE INDEX "manhwa_sources_source_id_idx" ON "manhwa_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "manhwa_titles_manhwa_id_idx" ON "manhwa_titles" USING btree ("manhwa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manhwa_titles_one_primary_idx" ON "manhwa_titles" USING btree ("manhwa_id") WHERE "manhwa_titles"."is_primary";--> statement-breakpoint
CREATE UNIQUE INDEX "reading_list_items_unique_idx" ON "reading_list_items" USING btree ("list_id","manhwa_id");--> statement-breakpoint
CREATE INDEX "reading_list_items_manhwa_id_idx" ON "reading_list_items" USING btree ("manhwa_id");--> statement-breakpoint
CREATE INDEX "reading_lists_user_id_idx" ON "reading_lists" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_progress_user_manhwa_idx" ON "reading_progress" USING btree ("user_id","manhwa_id");--> statement-breakpoint
CREATE INDEX "reading_progress_manhwa_id_idx" ON "reading_progress" USING btree ("manhwa_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_base_url_active_idx" ON "sources" USING btree ("base_url") WHERE "sources"."deleted_at" IS NULL;