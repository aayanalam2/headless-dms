import type { DocumentRow, VersionRow } from "../models/db/schema.ts";

// ---------------------------------------------------------------------------
// Document DTOs — outbound shapes for the documents API.
// Pure transformation functions: no I/O, no side effects.
// ---------------------------------------------------------------------------

export type VersionDTO = {
  readonly id: string;
  readonly documentId: string;
  readonly versionNumber: number;
  readonly bucketKey: string;
  readonly sizeBytes: number;
  readonly uploadedBy: string;
  readonly checksum: string;
  readonly createdAt: string; // ISO-8601
};

export type DocumentDTO = {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly contentType: string;
  readonly currentVersionId: string | null;
  readonly tags: string[];
  readonly metadata: Record<string, string>;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PaginatedDocumentsDTO = {
  readonly items: DocumentDTO[];
  readonly pagination: {
    readonly total: number;
    readonly page: number;
    readonly limit: number;
    readonly totalPages: number;
  };
};

// ---------------------------------------------------------------------------
// toVersionDTO
// ---------------------------------------------------------------------------

export function toVersionDTO(row: VersionRow): VersionDTO {
  return {
    id: row.id,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    bucketKey: row.bucketKey,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    checksum: row.checksum,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// toDocumentDTO
// ---------------------------------------------------------------------------

export function toDocumentDTO(row: DocumentRow): DocumentDTO {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    contentType: row.contentType,
    currentVersionId: row.currentVersionId ?? null,
    tags: row.tags,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// toPaginatedDocumentsDTO
// ---------------------------------------------------------------------------

export function toPaginatedDocumentsDTO(
  rows: DocumentRow[],
  total: number,
  page: number,
  limit: number,
): PaginatedDocumentsDTO {
  return {
    items: rows.map(toDocumentDTO),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
