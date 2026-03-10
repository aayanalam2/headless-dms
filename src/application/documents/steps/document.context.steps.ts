import { Effect as E, pipe } from "effect";
import {
  type DocumentId,
  type VersionId,
  type UserId,
  type Checksum,
  type BucketKey,
  newVersionId,
} from "@domain/utils/refined.types.ts";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import type { DocumentActorCtx } from "@application/shared/actor.ts";
import type { DocumentAccessGuard } from "@application/security/document-access.guard.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { DocumentWorkflowError, type DocumentWorkflowError as WorkflowError } from "../document-workflow.errors.ts";
import {
  liftRepo,
  liftConflict,
  requireVersion,
  requireVersionOfDocument,
  requireCurrentVersion,
} from "../services/document.repository.ts";
import {
  buildDocument,
  uploadAndHash,
  uploadFile,
  resolveVersionMeta,
  buildAndCommitVersion,
  buildAndCommitFirstDocument,
} from "../services/document.upload.ts";
import type { UploadVersionMeta, GetDocumentQueryDecoded } from "../dtos/document.dto.ts";

// ---------------------------------------------------------------------------
// Named pipeline context types
// ---------------------------------------------------------------------------

/** Assembled by prepareUpload — raw inputs parsed, IDs generated. */
export type UploadContext = {
  readonly docId: DocumentId;
  readonly verId: VersionId;
  readonly filename: string;
  readonly contentType: string;
  readonly bucketKey: BucketKey;
  readonly buffer: ArrayBuffer;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly actorId: UserId;
  readonly now: Date;
};

/** UploadContext after the Document entity has been constructed. */
export type UploadContextWithDoc = UploadContext & { readonly doc: Document };

/** UploadContextWithDoc after the buffer has been uploaded and hashed. */
export type UploadContextWithChecksum = UploadContextWithDoc & { readonly checksum: Checksum };

/** Output of commitFirstDocument — document and first version persisted. */
export type UploadContextCommitted = {
  readonly version: DocumentVersion;
  readonly updated: Document;
  readonly filename: string;
  readonly actorId: UserId;
};

/** Decoded version-upload command after timestamps are stamped — extends the DTO type. */
export type VersionUploadCtx = UploadVersionMeta & {
  readonly now: Date;
  readonly verId: VersionId;
};

/** VersionUploadCtx after the access guard has loaded the Document. */
export type VersionUploadCtxWithAccess = VersionUploadCtx & { readonly document: Document };

/** VersionUploadCtxWithAccess after upload metadata (filename, bucketKey, etc.) is resolved. */
export type VersionUploadCtxResolved = VersionUploadCtxWithAccess & {
  readonly filename: string;
  readonly contentType: string;
  readonly versionNumber: number;
  readonly bucketKey: BucketKey;
};

/** VersionUploadCtxResolved after the file has been uploaded. */
export type VersionUploadCtxWithFile = VersionUploadCtxResolved & {
  readonly buffer: ArrayBuffer;
  readonly checksum: Checksum;
};

/** VersionUploadCtxWithFile after the new version has been committed. */
export type VersionUploadCtxCommitted = VersionUploadCtxWithFile & {
  readonly version: DocumentVersion;
};

// ---------------------------------------------------------------------------
// Generic access context (reused across get / download / delete / listVersions)
// ---------------------------------------------------------------------------

/** Any decoded command/query that carries a documentId and actor — reuses DTO type. */
export type DocumentCmd<Extra = Record<never, never>> = GetDocumentQueryDecoded & Extra;

/** DocumentCmd after the access guard has loaded the Document entity. */
export type DocumentCmdWithDoc<Extra = Record<never, never>> = DocumentCmd<Extra> & {
  readonly document: Document;
};

// ---------------------------------------------------------------------------
// Context pipeline step functions
// ---------------------------------------------------------------------------

/**
 * Runs the access guard and merges the resulting Document into the context
 * under the key `document`, carrying all prior context forward.
 */
export function requireAccess<T extends DocumentActorCtx>(
  guard: DocumentAccessGuard,
  action: PermissionAction,
): (ctx: T) => E.Effect<T & { document: Document }, WorkflowError> {
  return (ctx) =>
    E.map(
      guard.require(ctx.documentId, ctx.actor, action, DocumentWorkflowError),
      (document) => ({ ...ctx, document }),
    );
}

/** Stamps the current timestamp and a fresh version id into the context. */
export function withVersionTimestamps(ctx: UploadVersionMeta & Record<string, unknown>): VersionUploadCtx & typeof ctx {
  return { ...ctx, now: new Date(), verId: newVersionId() } as VersionUploadCtx & typeof ctx;
}

/** Builds a Document entity and merges it into the context as `doc`. */
export function attachDoc(ctx: UploadContext): E.Effect<UploadContextWithDoc, WorkflowError> {
  return E.map(buildDocument(ctx), (doc) => ({ ...ctx, doc }));
}

/** Uploads the buffer to storage and hashes it, merging `checksum` into the context. */
export function attachChecksum(
  storage: IStorage,
): (ctx: UploadContextWithDoc) => E.Effect<UploadContextWithChecksum, WorkflowError> {
  return (ctx) =>
    E.map(
      uploadAndHash(storage, ctx.bucketKey, ctx.buffer, ctx.doc.contentType),
      (checksum) => ({ ...ctx, checksum }),
    );
}

/**
 * Builds the first DocumentVersion entity and atomically commits the new
 * document plus its version to the repository.
 */
export function commitFirstDocument(
  repo: IDocumentRepository,
): (ctx: UploadContextWithChecksum) => E.Effect<UploadContextCommitted, WorkflowError> {
  return (ctx) =>
    E.map(
      buildAndCommitFirstDocument(
        repo,
        ctx.doc,
        ctx.verId,
        ctx.bucketKey,
        ctx.buffer,
        ctx.checksum,
        ctx.actorId,
        ctx.now,
      ),
      ({ version, updated }) => ({ version, updated, filename: ctx.filename, actorId: ctx.actorId }),
    );
}

/** Resolves upload metadata for a new version and merges it into the context. */
export function resolveVersionCtx(
  repo: IDocumentRepository,
  file: File,
): (ctx: VersionUploadCtxWithAccess) => E.Effect<VersionUploadCtxResolved, WorkflowError> {
  return (ctx) =>
    E.map(
      resolveVersionMeta(repo, ctx.documentId, ctx.verId, ctx.name, file, ctx.document),
      (meta) => ({ ...ctx, ...meta }),
    );
}

/** Uploads the version file to storage and merges `buffer` and `checksum` into the context. */
export function attachVersionFile(
  storage: IStorage,
  file: File,
): (ctx: VersionUploadCtxResolved) => E.Effect<VersionUploadCtxWithFile, WorkflowError> {
  return (ctx) =>
    E.map(
      uploadFile(storage, file, ctx.bucketKey, ctx.contentType),
      ({ buffer, checksum }) => ({ ...ctx, buffer, checksum }),
    );
}

/** Builds a DocumentVersion entity and commits it atomically, merging `version` into the context. */
export function commitVersionCtx(
  repo: IDocumentRepository,
): (ctx: VersionUploadCtxWithFile) => E.Effect<VersionUploadCtxCommitted, WorkflowError> {
  return (ctx) =>
    E.map(
      buildAndCommitVersion(repo, ctx.verId, ctx.documentId, ctx.actor.userId, ctx.now, ctx),
      ({ version }) => ({ ...ctx, version }),
    );
}

/** Runs `document.softDelete()` and merges the resulting deleted entity as `deleted`. */
export function softDeleteInCtx<T extends { document: Document }>(
  ctx: T,
): E.Effect<T & { deleted: Document }, WorkflowError> {
  return E.map(liftConflict(ctx.document.softDelete()), (deleted) => ({ ...ctx, deleted }));
}

/** Persists the soft-delete to the repository, passing the context through unchanged. */
export function persistSoftDelete<T extends { deleted: Document }>(
  repo: IDocumentRepository,
): (ctx: T) => E.Effect<T, WorkflowError> {
  return (ctx) => E.as(liftRepo(repo.softDelete(ctx.deleted)), ctx);
}

/** Resolves the document's current version and merges it as `version` into the context. */
export function withCurrentVersionCtx<T extends { document: Document }>(
  repo: IDocumentRepository,
): (ctx: T) => E.Effect<T & { version: DocumentVersion }, WorkflowError> {
  return (ctx) =>
    E.map(requireCurrentVersion(repo, ctx.document), (version) => ({ ...ctx, version }));
}

/**
 * Resolves a specific version by id, verifies it belongs to `ctx.document`,
 * and merges it as `version` into the context.
 */
export function withVersionCtx<T extends { document: Document; versionId: VersionId }>(
  repo: IDocumentRepository,
): (ctx: T) => E.Effect<T & { version: DocumentVersion }, WorkflowError> {
  return (ctx) =>
    pipe(
      requireVersion(repo, ctx.versionId),
      E.flatMap((version) => requireVersionOfDocument(version, ctx.document)),
      E.map((version) => ({ ...ctx, version })),
    );
}
