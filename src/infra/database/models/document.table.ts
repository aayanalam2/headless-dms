import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { SharedColumns } from "../utils/shared-columns.ts";
import { usersTable } from "./user.table.ts";

// ---------------------------------------------------------------------------
// documents table
// ---------------------------------------------------------------------------

export const documentsTable = pgTable(
  "documents",
  {
    ...SharedColumns,
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    currentVersionId: uuid("current_version_id"),
    tags: text("tags").array().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    index("documents_owner_idx").on(t.ownerId),
    index("documents_deleted_at_idx").on(t.deletedAt),
  ],
);

export type DocumentRow = typeof documentsTable.$inferSelect;
export type NewDocumentRow = typeof documentsTable.$inferInsert;
