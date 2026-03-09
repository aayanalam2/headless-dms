import { Effect as E, pipe } from "effect";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { BucketKeyFactory } from "@domain/document/value-objects/bucket-key.vo.ts";
import { ChecksumFactory } from "@domain/document/value-objects/checksum.vo.ts";
import { Tags } from "@domain/document/value-objects/tags.vo.ts";
import { Metadata } from "@domain/document/value-objects/metadata.vo.ts";
import type {
  BucketKey,
  Checksum,
  DocumentId,
  VersionId,
  UserId,
} from "@domain/utils/refined.types.ts";
import { newDocumentId, newVersionId } from "@domain/utils/refined.types.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { commitVersion, commitNewDocument, liftRepo } from "./document.helpers.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "./document-workflow.errors.ts";

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
      liftRepo("storage.uploadFile", storage.uploadFile(bucketKey, Buffer.from(buffer), contentType)),
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
      E.map(uploadAndHash(storage, bucketKey, buffer, contentType), (checksum) => ({ buffer, checksum })),
    ),
  );
}

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
    liftRepo("repo.findVersionsByDocument", repo.findVersionsByDocument(documentId)),
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

/** Build a new DocumentVersion entity and commit it with the document update. */
export function buildAndCommitVersion(
  repo: IDocumentRepository,
  verId: VersionId,
  documentId: DocumentId,
  actorId: UserId,
  now: Date,
  ctx: {
    readonly document: Document;
    readonly filename: string;
    readonly versionNumber: number;
    readonly bucketKey: BucketKey;
    readonly buffer: ArrayBuffer;
    readonly checksum: Checksum;
  },
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

/**
 * Parse raw upload inputs (metadata, file buffer) and compute all derived values
 * needed for the initial document upload. Returns them as a single context object
 * so the workflow pipe can stay flat.
 */
export function prepareUpload(
  meta: {
    readonly name?: string | undefined;
    readonly rawTags?: string | undefined;
    readonly rawMetadata?: string | undefined;
    readonly actor: { readonly userId: UserId };
  },
  file: File,
): E.Effect<
  {
    readonly now: Date;
    readonly docId: DocumentId;
    readonly verId: VersionId;
    readonly filename: string;
    readonly contentType: string;
    readonly bucketKey: BucketKey;
    readonly tags: readonly string[];
    readonly metadata: Readonly<Record<string, string>>;
    readonly buffer: ArrayBuffer;
    readonly actorId: UserId;
  },
  WorkflowError
> {
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
      DocumentWorkflowError.invalidInput(
        "Metadata must be a valid JSON object of string values",
      ),
    ),
  );
  return E.map(
    E.all({ metadata: metadata$, buffer: E.promise(() => file.arrayBuffer()) }),
    ({ metadata, buffer }) => ({ now, docId, verId, filename, contentType, bucketKey, tags, metadata, buffer, actorId: meta.actor.userId }),
  );
}

/**
 * Construct a Document entity from upload context, mapping domain validation
 * errors to the appropriate workflow error type.
 */
export function buildDocument(
  ctx: {
    readonly docId: DocumentId;
    readonly actorId: UserId;
    readonly filename: string;
    readonly contentType: string;
    readonly tags: readonly string[];
    readonly metadata: Readonly<Record<string, string>>;
    readonly now: Date;
  },
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
