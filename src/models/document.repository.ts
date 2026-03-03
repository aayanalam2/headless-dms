import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { db } from "./db/connection.ts";
import {
  type AuditLogRow,
  type DocumentRow,
  type NewAuditLogRow,
  type NewDocumentRow,
  type NewVersionRow,
  type VersionRow,
  auditLogs,
  documentVersions,
  documents,
} from "./db/schema.ts";
import { Effect, Option } from "effect";
import { AppError } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// Search parameters — produced by search.service.ts (pure) and consumed here.
// ---------------------------------------------------------------------------

export enum SortField {
  Name = "name",
  CreatedAt = "createdAt",
  UpdatedAt = "updatedAt",
}

export enum SortOrder {
  Asc = "asc",
  Desc = "desc",
}

export type SearchParams = {
  readonly ownerId: Option.Option<string>;
  readonly name: Option.Option<string>;       // ILIKE match
  readonly contentType: Option.Option<string>; // exact match
  readonly tags: Option.Option<string[]>;      // array containment: doc.tags @> :tags
  readonly metadata: Option.Option<Record<string, string>>; // JSONB containment
  readonly page: number;     // 1-based
  readonly limit: number;    // max 100
  readonly sortBy: SortField;
  readonly sortOrder: SortOrder;
};

export type PaginatedDocuments = {
  readonly items: DocumentRow[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
};

// ---------------------------------------------------------------------------
// Document repository
// ---------------------------------------------------------------------------

export function findDocumentById(
  id: string,
): Effect.Effect<DocumentRow, AppError> {
  return Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
        .limit(1),
    catch: (e) => AppError.database(e),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.notFound(`Document(${id})`)),
    ),
  );
}

export function searchDocuments(
  params: SearchParams,
): Effect.Effect<PaginatedDocuments, AppError> {
  return Effect.tryPromise({
    try: async () => {
      const conditions = [isNull(documents.deletedAt)];

      if (Option.isSome(params.ownerId)) {
        conditions.push(eq(documents.ownerId, params.ownerId.value));
      }
      if (Option.isSome(params.name)) {
        conditions.push(ilike(documents.name, `%${params.name.value}%`));
      }
      if (Option.isSome(params.contentType)) {
        conditions.push(eq(documents.contentType, params.contentType.value));
      }
      if (Option.isSome(params.tags) && params.tags.value.length > 0) {
        conditions.push(
          sql`${documents.tags} @> ${sql.raw(`ARRAY[${params.tags.value.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]`)}`,
        );
      }
      if (Option.isSome(params.metadata) && Object.keys(params.metadata.value).length > 0) {
        conditions.push(
          sql`${documents.metadata} @> ${JSON.stringify(params.metadata.value)}::jsonb`,
        );
      }

      const where = and(...conditions);
      const offset = (params.page - 1) * params.limit;

      const orderCol =
        params.sortBy === SortField.Name
          ? documents.name
          : params.sortBy === SortField.UpdatedAt
            ? documents.updatedAt
            : documents.createdAt;

      const orderDir = params.sortOrder === SortOrder.Asc ? asc(orderCol) : desc(orderCol);

      const [items, countRows] = await Promise.all([
        db
          .select()
          .from(documents)
          .where(where)
          .orderBy(orderDir)
          .limit(params.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(documents)
          .where(where),
      ]);

      return {
        items,
        total: countRows[0]?.count ?? 0,
        page: params.page,
        limit: params.limit,
      };
    },
    catch: (e) => AppError.database(e),
  });
}

export function createDocument(
  data: NewDocumentRow,
): Effect.Effect<DocumentRow, AppError> {
  return Effect.tryPromise({
    try: () => db.insert(documents).values(data).returning(),
    catch: (e) => AppError.database(e),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.database("Insert returned no row")),
    ),
  );
}

export function updateDocument(
  id: string,
  data: Partial<
    Pick<DocumentRow, "currentVersionId" | "name" | "tags" | "metadata" | "updatedAt">
  >,
): Effect.Effect<DocumentRow, AppError> {
  return Effect.tryPromise({
    try: () =>
      db
        .update(documents)
        .set(data)
        .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
        .returning(),
    catch: (e) => AppError.database(e),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.notFound(`Document(${id})`)),
    ),
  );
}

export function softDeleteDocument(
  id: string,
): Effect.Effect<DocumentRow, AppError> {
  return Effect.tryPromise({
    try: () =>
      db
        .update(documents)
        .set({ deletedAt: new Date() })
        .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
        .returning(),
    catch: (e) => AppError.database(e),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.notFound(`Document(${id})`)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Version repository
// ---------------------------------------------------------------------------

export function createVersion(
  data: NewVersionRow,
): Effect.Effect<VersionRow, AppError> {
  return Effect.tryPromise({
    try: () => db.insert(documentVersions).values(data).returning(),
    catch: (e) => AppError.database(e),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.database("Insert returned no row")),
    ),
  );
}

export function listVersions(
  documentId: string,
): Effect.Effect<VersionRow[], AppError> {
  return Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId))
        .orderBy(asc(documentVersions.versionNumber)),
    catch: (e) => AppError.database(e),
  });
}

export function findVersionById(
  versionId: string,
): Effect.Effect<VersionRow, AppError> {
  return Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.id, versionId))
        .limit(1),
    catch: (e) => AppError.database(e),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.notFound(`Version(${versionId})`)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Audit log repository
// ---------------------------------------------------------------------------

export function insertAuditLog(
  data: NewAuditLogRow,
): Effect.Effect<AuditLogRow, AppError> {
  return Effect.tryPromise({
    try: () => db.insert(auditLogs).values(data).returning(),
    catch: (e) => AppError.database(e),
  }).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0]) : Effect.fail(AppError.database("Audit insert returned no row")),
    ),
  );
}

export function listAuditLogs(params: {
  page: number;
  limit: number;
  resourceType: Option.Option<string>;
  resourceId: Option.Option<string>;
}): Effect.Effect<{ items: AuditLogRow[]; total: number }, AppError> {
  return Effect.tryPromise({
    try: async () => {
      const conditions = [];
      if (Option.isSome(params.resourceType)) {
        conditions.push(eq(auditLogs.resourceType, params.resourceType.value));
      }
      if (Option.isSome(params.resourceId)) {
        conditions.push(eq(auditLogs.resourceId, params.resourceId.value));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const offset = (params.page - 1) * params.limit;

      const [items, countRows] = await Promise.all([
        db
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(desc(auditLogs.occurredAt))
          .limit(params.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`cast(count(*) as integer)` })
          .from(auditLogs)
          .where(where),
      ]);

      return { items, total: countRows[0]?.count ?? 0 };
    },
    catch: (e) => AppError.database(e),
  });
}
