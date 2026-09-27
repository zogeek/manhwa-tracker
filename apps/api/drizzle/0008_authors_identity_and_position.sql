ALTER TABLE "authors" ADD COLUMN "native_name" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "manhwa_authors" ADD COLUMN "position" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "authors_slug_idx" ON "authors" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "manhwa_authors" ADD CONSTRAINT "manhwa_authors_position_positive" CHECK ("manhwa_authors"."position" >= 0);