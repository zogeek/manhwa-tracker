CREATE TABLE "chapter_release_groups" (
	"release_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "chapter_release_groups_release_id_group_id_pk" PRIMARY KEY("release_id","group_id"),
	CONSTRAINT "chapter_release_groups_position_positive" CHECK ("chapter_release_groups"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "chapter_releases" DROP CONSTRAINT "chapter_releases_scanlation_group_id_scanlation_groups_id_fk";
--> statement-breakpoint
DROP INDEX "chapter_releases_scanlation_group_id_idx";--> statement-breakpoint
ALTER TABLE "scanlation_groups" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "scanlation_groups" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "chapter_release_groups" ADD CONSTRAINT "chapter_release_groups_release_id_chapter_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."chapter_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_release_groups" ADD CONSTRAINT "chapter_release_groups_group_id_scanlation_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."scanlation_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_release_groups_group_id_idx" ON "chapter_release_groups" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scanlation_groups_provider_external_id_idx" ON "scanlation_groups" USING btree ("provider","external_id") WHERE "scanlation_groups"."external_id" IS NOT NULL;--> statement-breakpoint
-- Reprise des données (ajout manuel) : chaque parution garde sa team, désormais dans la table de liaison.
INSERT INTO "chapter_release_groups" ("release_id", "group_id", "position")
SELECT "id", "scanlation_group_id", 0 FROM "chapter_releases" WHERE "scanlation_group_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_releases" DROP COLUMN "scanlation_group_id";--> statement-breakpoint
ALTER TABLE "scanlation_groups" ADD CONSTRAINT "scanlation_groups_external_id_has_provider" CHECK (("scanlation_groups"."provider" IS NULL) = ("scanlation_groups"."external_id" IS NULL));