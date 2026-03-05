import { Option, Schema as S } from "effect";
import type { Document } from "@domain/document/document.entity.ts";
import type { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { Paginated } from "@domain/utils/pagination.ts";

// ---------------------------------------------------------------------------
// Output DTO Schemas
//
// Types are DERIVED from these schemas — the schema is the single source of
// truth for the TypeScript type AND runtime shape. Never write the DTO type
// manually; always use `S.Schema.Type<typeof XxxDTOSchema>`.
// ---------------------------------------------------------------------------

export const VersionDTOSchema = S.Struct({
  id: S.String,
  documentId: S.String,
  versionNumber: S.Number,
  bucketKey: S.String,
  sizeBytes: S.Number,
  uploadedBy: S.String,
  checksum: S.String,
  createdAt: S.String,
});
export type VersionDTO = S.Schema.Type<typeof VersionDTOSchema>;

export const DocumentDTOSchema = S.Struct({
  id: S.String,
  ownerId: S.String,
  name: S.String,
  contentType: S.String,
  currentVersionId: S.NullOr(S.String),
  tags: S.Array(S.String),
  metadata: S.Record({ key: S.String, value: S.String }),
  createdAt: S.String,
  updatedAt: S.String,
});
export type DocumentDTO = S.Schema.Type<typeof DocumentDTOSchema>;

export const PageInfoSchema = S.Struct({
  total: S.Number,
  page: S.Number,
  limit: S.Number,
  totalPages: S.Number,
});
export type PageInfoDTO = S.Schema.Type<typeof PageInfoSchema>;

export const PaginatedDocumentsDTOSchema = S.Struct({
  items: S.Array(DocumentDTOSchema),
  pageInfo: PageInfoSchema,
});
export type PaginatedDocumentsDTO = S.Schema.Type<typeof PaginatedDocumentsDTOSchema>;

export const PresignedDownloadDTOSchema = S.Struct({
  url: S.String,
  expiresAt: S.String,
  version: VersionDTOSchema,
});
export type PresignedDownloadDTO = S.Schema.Type<typeof PresignedDownloadDTOSchema>;

// ---------------------------------------------------------------------------
// Mappers — domain entity → DTO (must produce values conforming to the schema)
// ---------------------------------------------------------------------------

export function toVersionDTO(version: DocumentVersion): VersionDTO {
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    bucketKey: version.bucketKey,
    sizeBytes: version.sizeBytes,
    uploadedBy: version.uploadedBy,
    checksum: version.checksum,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toDocumentDTO(document: Document): DocumentDTO {
  return {
    id: document.id,
    ownerId: document.ownerId,
    name: document.name,
    contentType: document.contentType,
    currentVersionId: Option.getOrNull(document.currentVersionId),
    tags: [...document.tags],
    metadata: document.metadata,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toPaginatedDocumentsDTO(paginated: Paginated<Document>): PaginatedDocumentsDTO {
  return {
    items: paginated.items.map(toDocumentDTO),
    pageInfo: paginated.pageInfo,
  };
}
