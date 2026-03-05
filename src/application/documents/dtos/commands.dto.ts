import { Schema as S } from "effect";
import { Role } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// ActorCommandSchema — raw actor shape flowing in from JWT claims.
//
// The HTTP middleware decodes the JWT and constructs this object; the workflow
// validates it at its boundary and converts `userId` to a branded `UserId`.
// ---------------------------------------------------------------------------

export const ActorCommandSchema = S.Struct({
  userId: S.String,
  role: S.Enums(Role),
});
export type ActorCommandEncoded = S.Schema.Encoded<typeof ActorCommandSchema>;
export type ActorCommand = S.Schema.Type<typeof ActorCommandSchema>;

// ---------------------------------------------------------------------------
// UploadDocumentMetaSchema
//
// The schema-validatable portion of the upload-document command.
// `file: File` is opaque (it is a browser/Bun runtime object that cannot be
// decoded from plain data) and is therefore passed as a separate argument.
// ---------------------------------------------------------------------------

export const UploadDocumentMetaSchema = S.Struct({
  actor: ActorCommandSchema,
  name: S.optional(S.String),
  rawTags: S.optional(S.String),
  rawMetadata: S.optional(S.String),
});
export type UploadDocumentMetaEncoded = S.Schema.Encoded<typeof UploadDocumentMetaSchema>;
export type UploadDocumentMeta = S.Schema.Type<typeof UploadDocumentMetaSchema>;

// ---------------------------------------------------------------------------
// UploadVersionMetaSchema
// ---------------------------------------------------------------------------

export const UploadVersionMetaSchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: S.String,
  name: S.optional(S.String),
});
export type UploadVersionMetaEncoded = S.Schema.Encoded<typeof UploadVersionMetaSchema>;
export type UploadVersionMeta = S.Schema.Type<typeof UploadVersionMetaSchema>;

// ---------------------------------------------------------------------------
// GetDocumentQuerySchema
// ---------------------------------------------------------------------------

export const GetDocumentQuerySchema = S.Struct({
  documentId: S.String,
  actor: ActorCommandSchema,
});
export type GetDocumentQueryEncoded = S.Schema.Encoded<typeof GetDocumentQuerySchema>;
export type GetDocumentQueryDecoded = S.Schema.Type<typeof GetDocumentQuerySchema>;

// ---------------------------------------------------------------------------
// ListDocumentsQuerySchema
//
// `page` and `limit` accept both numbers and numeric strings (query-string
// values arrive as strings from the HTTP layer).
// ---------------------------------------------------------------------------

export const ListDocumentsQuerySchema = S.Struct({
  actor: ActorCommandSchema,
  name: S.optional(S.String),
  ownerId: S.optional(S.String),
  page: S.optional(S.Union(S.Number, S.NumberFromString)),
  limit: S.optional(S.Union(S.Number, S.NumberFromString)),
});
export type ListDocumentsQueryEncoded = S.Schema.Encoded<typeof ListDocumentsQuerySchema>;
export type ListDocumentsQueryDecoded = S.Schema.Type<typeof ListDocumentsQuerySchema>;

// ---------------------------------------------------------------------------
// DownloadDocumentQuerySchema
// ---------------------------------------------------------------------------

export const DownloadDocumentQuerySchema = S.Struct({
  documentId: S.String,
  actor: ActorCommandSchema,
  expiresInSeconds: S.optional(S.Number),
});
export type DownloadDocumentQueryEncoded = S.Schema.Encoded<typeof DownloadDocumentQuerySchema>;
export type DownloadDocumentQueryDecoded = S.Schema.Type<typeof DownloadDocumentQuerySchema>;

// ---------------------------------------------------------------------------
// DownloadVersionQuerySchema
// ---------------------------------------------------------------------------

export const DownloadVersionQuerySchema = S.Struct({
  documentId: S.String,
  versionId: S.String,
  actor: ActorCommandSchema,
  expiresInSeconds: S.optional(S.Number),
});
export type DownloadVersionQueryEncoded = S.Schema.Encoded<typeof DownloadVersionQuerySchema>;
export type DownloadVersionQueryDecoded = S.Schema.Type<typeof DownloadVersionQuerySchema>;

// ---------------------------------------------------------------------------
// ListVersionsQuerySchema
// ---------------------------------------------------------------------------

export const ListVersionsQuerySchema = S.Struct({
  documentId: S.String,
  actor: ActorCommandSchema,
});
export type ListVersionsQueryEncoded = S.Schema.Encoded<typeof ListVersionsQuerySchema>;
export type ListVersionsQueryDecoded = S.Schema.Type<typeof ListVersionsQuerySchema>;

// ---------------------------------------------------------------------------
// DeleteDocumentCommandSchema
// ---------------------------------------------------------------------------

export const DeleteDocumentCommandSchema = S.Struct({
  documentId: S.String,
  actor: ActorCommandSchema,
});
export type DeleteDocumentCommandEncoded = S.Schema.Encoded<typeof DeleteDocumentCommandSchema>;
export type DeleteDocumentCommandDecoded = S.Schema.Type<typeof DeleteDocumentCommandSchema>;
