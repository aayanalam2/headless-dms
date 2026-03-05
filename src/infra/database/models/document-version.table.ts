import { bigint, check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { SharedColumns } from "../utils/shared-columns.ts";
import { documentsTable } from "./document.table.ts";
import { usersTable } from "./user.table.ts";

// ---------------------------------------------------------------------------
// document_versions table
// ---------------------------------------------------------------------------

export const documentVersionsTable = pgTable(
  "document_versions",
  {
    ...SharedColumns,
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    bucketKey: text("bucket_key").notNull().unique(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    checksum: text("checksum").notNull(),
  },
  (t) => [
    index("document_versions_document_idx").on(t.documentId),
    uniqueIndex("document_versions_doc_version_uidx").on(t.documentId, t.versionNumber),
    check("document_versions_version_min_chk", sql`${t.versionNumber} >= 1`),
  ],
);

export type VersionRow = typeof documentVersionsTable.$inferSelect;
export type NewVersionRow = typeof documentVersionsTable.$inferInsert;
