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
import { AppError, type AppResult, Result } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// Search parameters — produced by search.service.ts (pure) and consumed here.
// ---------------------------------------------------------------------------

export type SortField = "name" | "createdAt" | "updatedAt";
export type SortOrder = "asc" | "desc";

export type SearchParams = {
  readonly ownerId?: string;
  readonly name?: string; // ILIKE match
  readonly contentType?: string; // exact match
  readonly tags?: string[]; // array containment: doc.tags @> :tags
  readonly metadata?: Record<string, string>; // JSONB containment
  readonly page: number; // 1-based
  readonly limit: number; // max 100
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

export async function findDocumentById(
  id: string,
): Promise<AppResult<DocumentRow>> {
  try {
    const rows = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return Result.Err(AppError.notFound(`Document(${id})`));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function searchDocuments(
  params: SearchParams,
): Promise<AppResult<PaginatedDocuments>> {
  try {
    const conditions = [isNull(documents.deletedAt)];

    if (params.ownerId) {
      conditions.push(eq(documents.ownerId, params.ownerId));
    }
    if (params.name) {
      conditions.push(ilike(documents.name, `%${params.name}%`));
    }
    if (params.contentType) {
      conditions.push(eq(documents.contentType, params.contentType));
    }
    if (params.tags && params.tags.length > 0) {
      // PostgreSQL array containment: tags @> ARRAY[...]
      conditions.push(
        sql`${documents.tags} @> ${sql.raw(`ARRAY[${params.tags.map((t) => `'${t.replace(/'/g, "''")}'`).join(",")}]`)}`,
      );
    }
    if (params.metadata && Object.keys(params.metadata).length > 0) {
      // JSONB containment: metadata @> '{"key":"value"}'
      conditions.push(
        sql`${documents.metadata} @> ${JSON.stringify(params.metadata)}::jsonb`,
      );
    }

    const where = and(...conditions);
    const offset = (params.page - 1) * params.limit;

    const orderCol =
      params.sortBy === "name"
        ? documents.name
        : params.sortBy === "updatedAt"
          ? documents.updatedAt
          : documents.createdAt;

    const orderDir = params.sortOrder === "asc" ? asc(orderCol) : desc(orderCol);

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

    const total = countRows[0]?.count ?? 0;

    return Result.Ok({
      items,
      total,
      page: params.page,
      limit: params.limit,
    });
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function createDocument(
  data: NewDocumentRow,
): Promise<AppResult<DocumentRow>> {
  try {
    const rows = await db.insert(documents).values(data).returning();
    const row = rows[0];
    if (!row) return Result.Err(AppError.database("Insert returned no row"));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function updateDocument(
  id: string,
  data: Partial<
    Pick<DocumentRow, "currentVersionId" | "name" | "tags" | "metadata" | "updatedAt">
  >,
): Promise<AppResult<DocumentRow>> {
  try {
    const rows = await db
      .update(documents)
      .set(data)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .returning();
    const row = rows[0];
    if (!row) return Result.Err(AppError.notFound(`Document(${id})`));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function softDeleteDocument(
  id: string,
): Promise<AppResult<DocumentRow>> {
  try {
    const rows = await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .returning();
    const row = rows[0];
    if (!row) return Result.Err(AppError.notFound(`Document(${id})`));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

// ---------------------------------------------------------------------------
// Version repository
// ---------------------------------------------------------------------------

export async function createVersion(
  data: NewVersionRow,
): Promise<AppResult<VersionRow>> {
  try {
    const rows = await db.insert(documentVersions).values(data).returning();
    const row = rows[0];
    if (!row) return Result.Err(AppError.database("Insert returned no row"));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function listVersions(
  documentId: string,
): Promise<AppResult<VersionRow[]>> {
  try {
    const rows = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(asc(documentVersions.versionNumber));
    return Result.Ok(rows);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function findVersionById(
  versionId: string,
): Promise<AppResult<VersionRow>> {
  try {
    const rows = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.id, versionId))
      .limit(1);
    const row = rows[0];
    if (!row) return Result.Err(AppError.notFound(`Version(${versionId})`));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

// ---------------------------------------------------------------------------
// Audit log repository
// ---------------------------------------------------------------------------

export async function insertAuditLog(
  data: NewAuditLogRow,
): Promise<AppResult<AuditLogRow>> {
  try {
    const rows = await db.insert(auditLogs).values(data).returning();
    const row = rows[0];
    if (!row) return Result.Err(AppError.database("Audit insert returned no row"));
    return Result.Ok(row);
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}

export async function listAuditLogs(params: {
  page: number;
  limit: number;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
}): Promise<AppResult<{ items: AuditLogRow[]; total: number }>> {
  try {
    const conditions = [];
    if (params.resourceType) {
      conditions.push(eq(auditLogs.resourceType, params.resourceType));
    }
    if (params.resourceId) {
      conditions.push(eq(auditLogs.resourceId, params.resourceId));
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

    return Result.Ok({ items, total: countRows[0]?.count ?? 0 });
  } catch (cause) {
    return Result.Err(AppError.database(cause));
  }
}
