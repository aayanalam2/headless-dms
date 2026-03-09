import { Schema as S } from "effect";
import { optionToMaybe } from "@domain/utils/utils.ts";
import { DocumentSchema, type Document } from "@domain/document/document.entity.ts";
import {
  DocumentVersionSchema,
  type DocumentVersion,
} from "@domain/document/document-version.entity.ts";
import { UserSchema } from "@domain/user/user.entity.ts";
import type { Paginated } from "@domain/utils/pagination.ts";
import { ActorCommandSchema } from "@application/shared/actor.ts";
import type { ActorCommandEncoded, ActorCommand } from "@application/shared/actor.ts";
import { PaginationQuerySchema } from "@application/shared/pagination.ts";

export { ActorCommandSchema };
export type { ActorCommandEncoded, ActorCommand };

// ===========================================================================
// INBOUND — Command / Query schemas
// ===========================================================================

/** Default lifetime of a presigned download URL, in seconds. */
export const DEFAULT_PRESIGNED_URL_TTL_SECONDS = 300;

export const UploadDocumentMetaSchema = S.Struct({
  actor: ActorCommandSchema,
  name: S.optional(S.String),
  rawTags: S.optional(S.String),
  rawMetadata: S.optional(S.String),
});
export type UploadDocumentMetaEncoded = S.Schema.Encoded<typeof UploadDocumentMetaSchema>;
export type UploadDocumentMeta = S.Schema.Type<typeof UploadDocumentMetaSchema>;

export const UploadVersionMetaSchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: DocumentSchema.fields.id,
  name: S.optional(S.String),
});
export type UploadVersionMetaEncoded = S.Schema.Encoded<typeof UploadVersionMetaSchema>;
export type UploadVersionMeta = S.Schema.Type<typeof UploadVersionMetaSchema>;

export const GetDocumentQuerySchema = S.Struct({
  documentId: DocumentSchema.fields.id,
  actor: ActorCommandSchema,
});
export type GetDocumentQueryEncoded = S.Schema.Encoded<typeof GetDocumentQuerySchema>;
export type GetDocumentQueryDecoded = S.Schema.Type<typeof GetDocumentQuerySchema>;

export const ListDocumentsQuerySchema = S.Struct({
  ...PaginationQuerySchema.fields,
  actor: ActorCommandSchema,
  name: S.optional(S.String),
  ownerId: S.optional(UserSchema.fields.id),
});
export type ListDocumentsQueryEncoded = S.Schema.Encoded<typeof ListDocumentsQuerySchema>;
export type ListDocumentsQueryDecoded = S.Schema.Type<typeof ListDocumentsQuerySchema>;

export const DownloadDocumentQuerySchema = S.Struct({
  documentId: DocumentSchema.fields.id,
  actor: ActorCommandSchema,
  expiresInSeconds: S.optional(S.Number),
});
export type DownloadDocumentQueryEncoded = S.Schema.Encoded<typeof DownloadDocumentQuerySchema>;
export type DownloadDocumentQueryDecoded = S.Schema.Type<typeof DownloadDocumentQuerySchema>;

export const DownloadVersionQuerySchema = S.Struct({
  documentId: DocumentSchema.fields.id,
  versionId: DocumentVersionSchema.fields.id,
  actor: ActorCommandSchema,
  expiresInSeconds: S.optional(S.Number),
});
export type DownloadVersionQueryEncoded = S.Schema.Encoded<typeof DownloadVersionQuerySchema>;
export type DownloadVersionQueryDecoded = S.Schema.Type<typeof DownloadVersionQuerySchema>;

export const ListVersionsQuerySchema = S.Struct({
  documentId: DocumentSchema.fields.id,
  actor: ActorCommandSchema,
});
export type ListVersionsQueryEncoded = S.Schema.Encoded<typeof ListVersionsQuerySchema>;
export type ListVersionsQueryDecoded = S.Schema.Type<typeof ListVersionsQuerySchema>;

export const DeleteDocumentCommandSchema = S.Struct({
  documentId: DocumentSchema.fields.id,
  actor: ActorCommandSchema,
});
export type DeleteDocumentCommandEncoded = S.Schema.Encoded<typeof DeleteDocumentCommandSchema>;
export type DeleteDocumentCommandDecoded = S.Schema.Type<typeof DeleteDocumentCommandSchema>;

// ===========================================================================
// OUTBOUND — Response DTO schemas + mappers
// `Encoded` gives the wire form: plain strings, no branded types.
// ===========================================================================

export const VersionDTOSchema = DocumentVersionSchema;
export type VersionDTO = S.Schema.Encoded<typeof VersionDTOSchema>;

// `deletedAt` intentionally excluded — consumers see active documents only
export const DocumentDTOSchema = DocumentSchema.omit("deletedAt");
export type DocumentDTO = S.Schema.Encoded<typeof DocumentDTOSchema>;

export type PaginatedDocumentsDTO = Paginated<DocumentDTO>;

export const PresignedDownloadDTOSchema = S.Struct({
  url: S.String,
  expiresAt: S.String,
  version: VersionDTOSchema,
});
export type PresignedDownloadDTO = S.Schema.Encoded<typeof PresignedDownloadDTOSchema>;

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
    currentVersionId: optionToMaybe(document.currentVersionId),
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
