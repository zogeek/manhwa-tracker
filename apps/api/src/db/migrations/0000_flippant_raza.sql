CREATE TABLE "manhwas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"cover_url" text,
	"current_chapter_read" integer DEFAULT 0 NOT NULL,
	"latest_chapter_available" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
