DROP INDEX "external_links_provider_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "external_links_provider_external_id_idx" ON "external_links" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "manhwa_titles_title_trgm_idx" ON "manhwa_titles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "manhwas_title_trgm_idx" ON "manhwas" USING gin ("title" gin_trgm_ops) WHERE "manhwas"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "manhwas_original_title_trgm_idx" ON "manhwas" USING gin ("original_title" gin_trgm_ops) WHERE "manhwas"."deleted_at" IS NULL;