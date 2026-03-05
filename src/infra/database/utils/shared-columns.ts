import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Columns shared by every application table:
 *
 *   id        — application-assigned UUID (domain layer generates this, no defaultRandom())
 *   createdAt — set once on first insert
 *   updatedAt — refreshed on every write
 *
 * Spread into your table definition:
 * ```ts
 * export const myTable = pgTable("my_table", {
 *   ...SharedColumns,
 *   name: text("name").notNull(),
 * });
 * ```
 */
export const SharedColumns = {
  id: uuid("id").primaryKey().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
} as const;

