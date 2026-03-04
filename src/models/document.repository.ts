import type { Effect } from "effect";
import { Option } from "effect";
import type {
  AuditLogRow,
  DocumentRow,
  NewAuditLogRow,
  NewDocumentRow,
  NewVersionRow,
  VersionRow,
} from "./db/schema.ts";
import type { AppError } from "../types/errors.ts";

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
  readonly name: Option.Option<string>; // ILIKE match
  readonly contentType: Option.Option<string>; // exact match
  readonly tags: Option.Option<string[]>; // array containment: doc.tags @> :tags
  readonly metadata: Option.Option<Record<string, string>>; // JSONB containment
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

export type IDocumentRepository = {
  findDocumentById(id: string, actorId?: string): Effect.Effect<DocumentRow, AppError>;

  searchDocuments(params: SearchParams): Effect.Effect<PaginatedDocuments, AppError>;

  createDocument(data: NewDocumentRow): Effect.Effect<DocumentRow, AppError>;

  updateDocument(
    id: string,
    data: Partial<
      Pick<DocumentRow, "currentVersionId" | "name" | "tags" | "metadata" | "updatedAt">
    >,
  ): Effect.Effect<DocumentRow, AppError>;

  softDeleteDocument(id: string): Effect.Effect<DocumentRow, AppError>;

  // Versions

  createVersion(data: NewVersionRow): Effect.Effect<VersionRow, AppError>;

  listVersions(documentId: string): Effect.Effect<VersionRow[], AppError>;

  findVersionById(versionId: string): Effect.Effect<VersionRow, AppError>;

  // Audit logs

  insertAuditLog(data: NewAuditLogRow): Effect.Effect<AuditLogRow, AppError>;

  listAuditLogs(params: {
    page: number;
    limit: number;
    resourceType: Option.Option<string>;
    resourceId: Option.Option<string>;
  }): Effect.Effect<{ items: AuditLogRow[]; total: number }, AppError>;
};
