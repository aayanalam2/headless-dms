import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { Role } from "../../types/enums.ts";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum("role", ["admin", "user"]);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default(Role.User).$type<Role>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    // Points at the latest accepted version; null until first version is stored
    currentVersionId: uuid("current_version_id"),
    // PostgreSQL text array for fast tag-based filtering
    tags: text("tags").array().notNull().default([]),
    // Arbitrary key/value metadata stored as JSONB
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete — null means the document is active
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("documents_owner_idx").on(t.ownerId),
    index("documents_deleted_at_idx").on(t.deletedAt),
  ],
);

export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

// ---------------------------------------------------------------------------
// document_versions
// Versions are immutable — files are never overwritten in S3.
// ---------------------------------------------------------------------------

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    versionNumber: integer("version_number").notNull(),
    // The fully-qualified S3 object key: {documentId}/{versionId}/{filename}
    bucketKey: text("bucket_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // SHA-256 hex digest of the uploaded file
    checksum: text("checksum").notNull(),
  },
  (t) => [
    index("document_versions_document_idx").on(t.documentId),
  ],
);

export type VersionRow = typeof documentVersions.$inferSelect;
export type NewVersionRow = typeof documentVersions.$inferInsert;

// ---------------------------------------------------------------------------
// audit_logs
// Append-only record of who did what to which resource and when.
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;
