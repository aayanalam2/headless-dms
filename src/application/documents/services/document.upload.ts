import { Effect as E, pipe } from "effect";
import {
  type DocumentId,
  type VersionId,
  type UserId,
  type Checksum,
  type BucketKey,
  newDocumentId,
  newVersionId,
} from "@domain/utils/refined.types.ts";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { BucketKeyFactory } from "@domain/document/value-objects/bucket-key.vo.ts";
import { ChecksumFactory } from "@domain/document/value-objects/checksum.vo.ts";
import { Tags } from "@domain/document/value-objects/tags.vo.ts";
import { Metadata } from "@domain/document/value-objects/metadata.vo.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";
import { liftRepo, commitVersion, commitNewDocument } from "./document.repository.ts";
import type {
  UploadContext,
  VersionUploadCtxWithFile,
} from "../steps/document.context.steps.ts";
import type { UploadDocumentMeta } from "../dtos/document.dto.ts";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/** Upload a buffer to storage and compute its checksum in parallel. */
export function uploadAndHash(
  storage: IStorage,
  bucketKey: BucketKey,
  buffer: ArrayBuffer,
  contentType: string,
): E.Effect<Checksum, WorkflowError> {
  return pipe(
    E.all([
      ChecksumFactory.fromBuffer(buffer),
      liftRepo(storage.uploadFile(bucketKey, Buffer.from(buffer), contentType)),
    ]),
    E.map(([checksum]) => checksum),
  );
}

/** Read a file, upload it to storage, and return both the raw buffer and its checksum. */
export function uploadFile(
  storage: IStorage,
  file: File,
  bucketKey: BucketKey,
  contentType: string,
): E.Effect<{ readonly buffer: ArrayBuffer; readonly checksum: Checksum }, WorkflowError> {
  return pipe(
    E.promise(() => file.arrayBuffer()),
    E.flatMap((buffer) =>
      E.map(uploadAndHash(storage, bucketKey, buffer, contentType), (checksum) => ({
        buffer,
        checksum,
      })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Version metadata resolution
// ---------------------------------------------------------------------------

/** Fetch the existing version list and derive upload metadata for a new version. */
export function resolveVersionMeta(
  repo: IDocumentRepository,
  documentId: DocumentId,
  verId: VersionId,
  name: string | undefined,
  file: File,
  document: Document,
): E.Effect<
  {
    readonly document: Document;
    readonly filename: string;
    readonly contentType: string;
    readonly versionNumber: number;
    readonly bucketKey: BucketKey;
  },
  WorkflowError
> {
  return pipe(
    liftRepo(repo.findVersionsByDocument(documentId)),
    E.map((versions) => {
      const filename = name?.trim() || file.name || document.name;
      return {
        document,
        filename,
        contentType: file.type || document.contentType,
        versionNumber: DocumentVersion.nextNumber(versions),
        bucketKey: BucketKeyFactory.forVersion(documentId, verId, filename),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Entity construction and commit
// ---------------------------------------------------------------------------

/** Build a new DocumentVersion entity and commit it with the document update. */
export function buildAndCommitVersion(
  repo: IDocumentRepository,
  verId: VersionId,
  documentId: DocumentId,
  actorId: UserId,
  now: Date,
  ctx: Pick<VersionUploadCtxWithFile, "document" | "filename" | "versionNumber" | "bucketKey" | "buffer" | "checksum">,
): E.Effect<
  { readonly version: DocumentVersion; readonly versionNumber: number; readonly filename: string },
  WorkflowError
> {
  const version = DocumentVersion.createNew({
    id: verId,
    documentId,
    versionNumber: ctx.versionNumber,
    bucketKey: ctx.bucketKey,
    sizeBytes: ctx.buffer.byteLength,
    checksum: ctx.checksum,
    uploadedBy: actorId,
    createdAt: now,
  });
  return E.as(commitVersion(repo, ctx.document, version, now), {
    version,
    versionNumber: ctx.versionNumber,
    filename: ctx.filename,
  });
}

/** Build the initial DocumentVersion entity (versionNumber=1) and commit a new document. */
export function buildAndCommitFirstDocument(
  repo: IDocumentRepository,
  doc: Document,
  verId: VersionId,
  bucketKey: BucketKey,
  buffer: ArrayBuffer,
  checksum: Checksum,
  actorId: UserId,
  now: Date,
): E.Effect<{ readonly version: DocumentVersion; readonly updated: Document }, WorkflowError> {
  const version = DocumentVersion.createNew({
    id: verId,
    documentId: doc.id,
    versionNumber: 1,
    bucketKey,
    sizeBytes: buffer.byteLength,
    checksum,
    uploadedBy: actorId,
    createdAt: now,
  });
  return commitNewDocument(repo, doc, version, now);
}

// ---------------------------------------------------------------------------
// Upload preparation
// ---------------------------------------------------------------------------

/** Construct a Document entity from upload context, mapping domain validation errors. */
export function buildDocument(
  ctx: Pick<UploadContext, "docId" | "actorId" | "filename" | "contentType" | "tags" | "metadata" | "now">,
): E.Effect<Document, WorkflowError> {
  return E.mapError(
    Document.createNew({
      id: ctx.docId,
      ownerId: ctx.actorId,
      name: ctx.filename,
      contentType: ctx.contentType,
      tags: ctx.tags,
      metadata: ctx.metadata,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    }),
    (e) => DocumentWorkflowError.invalidContentType(e.contentType),
  );
}

/** Parse and assemble all upload inputs into a typed context object. */
export function prepareUpload(
  meta: UploadDocumentMeta,
  file: File,
): E.Effect<UploadContext, WorkflowError> {
  const now = new Date();
  const docId = newDocumentId();
  const verId = newVersionId();
  const filename = meta.name?.trim() || file.name || "untitled";
  const contentType = file.type;
  const bucketKey = BucketKeyFactory.forVersion(docId, verId, filename);
  const tags = Tags.parse(meta.rawTags).value;
  const metadata$ = pipe(
    Metadata.parse(meta.rawMetadata),
    E.map((m) => m.value),
    E.mapError(() =>
      DocumentWorkflowError.invalidInput("Metadata must be a valid JSON object of string values"),
    ),
  );
  return E.map(
    E.all({ metadata: metadata$, buffer: E.promise(() => file.arrayBuffer()) }),
    ({ metadata, buffer }) => ({
      now,
      docId,
      verId,
      filename,
      contentType,
      bucketKey,
      tags,
      metadata,
      buffer,
      actorId: meta.actor.userId,
    }),
  );
}
