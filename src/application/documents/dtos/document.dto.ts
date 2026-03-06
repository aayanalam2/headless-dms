import { Option, Schema as S } from "effect";
import { DocumentSchema, type Document } from "@domain/document/document.entity.ts";
import {
  DocumentVersionSchema,
  type DocumentVersion,
} from "@domain/document/document-version.entity.ts";
import type { Paginated } from "@domain/utils/pagination.ts";

// ---------------------------------------------------------------------------
// Output DTO Schemas
//
// Fields are pulled directly from the entity schemas so the DTO shape never
// drifts from the domain model.  `Encoded` gives the wire form (plain
// strings, ISO dates, null instead of Option) — exactly what the HTTP layer
// should serialise.
//
// `deletedAt` is intentionally omitted from DocumentDTOSchema: it is an
// internal soft-delete marker, not a field consumers should reason about.
// ---------------------------------------------------------------------------

export const VersionDTOSchema = S.Struct({
  id: DocumentVersionSchema.fields.id,
  documentId: DocumentVersionSchema.fields.documentId,
  versionNumber: DocumentVersionSchema.fields.versionNumber,
  bucketKey: DocumentVersionSchema.fields.bucketKey,
  sizeBytes: DocumentVersionSchema.fields.sizeBytes,
  uploadedBy: DocumentVersionSchema.fields.uploadedBy,
  checksum: DocumentVersionSchema.fields.checksum,
  createdAt: DocumentVersionSchema.fields.createdAt,
});
export type VersionDTO = S.Schema.Encoded<typeof VersionDTOSchema>;

export const DocumentDTOSchema = S.Struct({
  id: DocumentSchema.fields.id,
  ownerId: DocumentSchema.fields.ownerId,
  name: DocumentSchema.fields.name,
  contentType: DocumentSchema.fields.contentType,
  currentVersionId: DocumentSchema.fields.currentVersionId,
  tags: DocumentSchema.fields.tags,
  metadata: DocumentSchema.fields.metadata,
  createdAt: DocumentSchema.fields.createdAt,
  updatedAt: DocumentSchema.fields.updatedAt,
  // deletedAt intentionally excluded — consumers see active documents only
});
export type DocumentDTO = S.Schema.Encoded<typeof DocumentDTOSchema>;

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
export type PaginatedDocumentsDTO = S.Schema.Encoded<typeof PaginatedDocumentsDTOSchema>;

export const PresignedDownloadDTOSchema = S.Struct({
  url: S.String,
  expiresAt: S.String,
  version: VersionDTOSchema,
});
export type PresignedDownloadDTO = S.Schema.Encoded<typeof PresignedDownloadDTOSchema>;

// ---------------------------------------------------------------------------
// Mappers — domain entity → DTO (wire / encoded form)
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
