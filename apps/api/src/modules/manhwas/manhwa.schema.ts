import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  date,
  real,
} from "drizzle-orm/pg-core";

export const manhwaTypeEnum = pgEnum("manhwa_type", [
  "manga",
  "manhwa",
  "manhua",
  "webtoon",
]);

export const manhwaStatusEnum = pgEnum("manhwa_status", [
  "ongoing",
  "completed",
  "hiatus",
  "cancelled",
]);

export const manhwas = pgTable("manhwas", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  synopsis: text("synopsis"),
  coverUrl: text("cover_url"),
  type: manhwaTypeEnum("type").default("manhwa").notNull(),
  status: manhwaStatusEnum("status").default("ongoing").notNull(),
  country: text("country").default("KR"),
  totalChapters: integer("total_chapters"),
  rating: real("rating"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  // Audit
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: text("created_by"), // user_id Better Auth
  updatedBy: text("updated_by"), // user_id Better Auth
  deletedAt: timestamp("deleted_at"), // null = actif, sinon soft-deleted
});

export type Manhwa = InferSelectModel<typeof manhwas>;
export type NewManhwa = InferInsertModel<typeof manhwas>;
