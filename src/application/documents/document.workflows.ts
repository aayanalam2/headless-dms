import { inject, injectable } from "tsyringe";
import { Effect, Option, pipe } from "effect";
import { Document } from "@domain/document/document.entity.ts";
import type { ContentType } from "@domain/document/value-objects/content-type.vo.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";
import { parsePagination } from "@domain/utils/pagination.ts";
import { type BucketKey, type Checksum } from "@domain/utils/refined.types.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import {
  buildBucketKey,
  parseTags,
  parseMetadata,
  hashBuffer,
  commitVersion,
  requireAccessibleDocument,
  assertAdminOnly,
  requireDocument,
  requireActiveDocument,
  requireVersion,
  requireVersionOfDocument,
  requireCurrentVersion,
  emitDocumentUploaded,
  emitVersionCreated,
  emitDocumentDeleted,
} from "./document.helpers.ts";
import {
  toDocumentDTO,
  toVersionDTO,
  type DocumentDTO,
  type PaginatedDocumentsDTO,
  type PresignedDownloadDTO,
  type VersionDTO,
} from "./dtos/document.dto.ts";
import {
  UploadDocumentMetaSchema,
  UploadVersionMetaSchema,
  GetDocumentQuerySchema,
  ListDocumentsQuerySchema,
  DownloadDocumentQuerySchema,
  DownloadVersionQuerySchema,
  ListVersionsQuerySchema,
  DeleteDocumentCommandSchema,
  DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  type UploadDocumentMetaEncoded,
  type UploadVersionMetaEncoded,
  type GetDocumentQueryEncoded,
  type ListDocumentsQueryEncoded,
  type DownloadDocumentQueryEncoded,
  type DownloadVersionQueryEncoded,
  type ListVersionsQueryEncoded,
  type DeleteDocumentCommandEncoded,
} from "./dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "./document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Result types (consumed by controllers)
// ---------------------------------------------------------------------------

export type UploadDocumentResult = {
  readonly document: DocumentDTO;
  readonly version: VersionDTO;
};

export type UploadVersionResult = { readonly version: VersionDTO };

// ---------------------------------------------------------------------------
// Module-level error mapper
// ---------------------------------------------------------------------------

const unavailable =
  (op: string) =>
  (e: unknown): WorkflowError =>
    DocumentWorkflowError.unavailable(op, e);

// Parallel SHA-256 hash and S3 upload — returns the checksum on success.
function uploadAndHash(
  storage: IStorage,
  bucketKey: BucketKey,
  buffer: ArrayBuffer,
  contentType: string,
): Effect.Effect<Checksum, WorkflowError> {
  return pipe(
    Effect.all([
      hashBuffer(buffer),
      pipe(
        storage.uploadFile(bucketKey, Buffer.from(buffer), contentType),
        Effect.mapError(unavailable("storage.uploadFile")),
      ),
    ]),
    Effect.map(([checksum]) => checksum),
  );
}

// Generates a presigned download URL and returns the PresignedDownloadDTO shape.
function buildPresignedResponse(
  storage: IStorage,
  version: DocumentVersion,
  ttl: number,
): Effect.Effect<PresignedDownloadDTO, WorkflowError> {
  return pipe(
    storage.getPresignedDownloadUrl(version.bucketKey, ttl),
    Effect.mapError((e) =>
      DocumentWorkflowError.unavailable("storage.getPresignedDownloadUrl", e),
    ),
    Effect.map((url) => ({
      url,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      version: toVersionDTO(version),
    })),
  );
}

// ---------------------------------------------------------------------------
// DocumentWorkflows — injectable application service
// ---------------------------------------------------------------------------

@injectable()
export class DocumentWorkflows {
  constructor(
    @inject(TOKENS.DocumentRepository) private readonly documentRepo: IDocumentRepository,
    @inject(TOKENS.StorageService) private readonly storage: IStorage,
  ) {}

  // -------------------------------------------------------------------------
  // upload
  // -------------------------------------------------------------------------

  upload(
    rawMeta: UploadDocumentMetaEncoded,
    file: File,
  ): Effect.Effect<UploadDocumentResult, WorkflowError> {
    return pipe(
      decodeCommand(UploadDocumentMetaSchema, rawMeta, DocumentWorkflowError.invalidInput),
      Effect.flatMap((meta) => {
        const now = new Date();
        const docId = crypto.randomUUID();
        const verId = crypto.randomUUID();
        const filename = meta.name?.trim() || file.name || "untitled";
        const contentType = (file.type || "application/octet-stream") as ContentType;
        const bucketKey = buildBucketKey(docId, verId, filename);

        return pipe(
          // parse params
          Effect.all([
            parseMetadata(meta.rawMetadata),
            Effect.promise(() => file.arrayBuffer()),
          ]),
          Effect.map(([metadata, buffer]) => ({
            metadata,
            buffer,
            tags: parseTags(Option.fromNullable(meta.rawTags)),
          })),

          // create doc
          Effect.flatMap(({ metadata, buffer, tags }) =>
            pipe(
              Document.create({
                id: docId,
                ownerId: meta.actor.userId as string,
                name: filename,
                contentType,
                currentVersionId: null,
                tags,
                metadata,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                deletedAt: null,
              }),
              Effect.mapError((e) => DocumentWorkflowError.invalidContentType(e.contentType)),
              Effect.map((doc) => ({ doc, buffer })),
            ),
          ),

          // upload
          Effect.flatMap(({ doc, buffer }) =>
            pipe(
              uploadAndHash(this.storage, bucketKey, buffer, doc.contentType),
              Effect.map((checksum) => ({ doc, buffer, checksum })),
            ),
          ),

          // save
          Effect.flatMap(({ doc, buffer, checksum }) =>
            pipe(
              this.documentRepo.save(doc),
              Effect.mapError(unavailable("repo.save")),
              Effect.as({ doc, buffer, checksum }),
            ),
          ),

          // save version
          Effect.flatMap(({ doc, buffer, checksum }) =>
            pipe(
              DocumentVersion.create({
                id: verId,
                documentId: docId,
                versionNumber: 1,
                bucketKey: bucketKey as string,
                sizeBytes: buffer.byteLength,
                checksum: checksum as string,
                uploadedBy: meta.actor.userId as string,
                createdAt: now.toISOString(),
              }),
              Effect.mapError((e) =>
                DocumentWorkflowError.unavailable("DocumentVersion.create", e),
              ),
              Effect.flatMap((version) => commitVersion(this.documentRepo, doc, version, now)),
            ),
          ),

          // emit event
          Effect.tap(({ updated, version }) =>
            emitDocumentUploaded({
              actorId: meta.actor.userId,
              resourceId: updated.id as string,
              versionId: version.id as string,
              filename,
              contentType: updated.contentType,
            }),
          ),

          Effect.map(({ updated, version }) => ({
            document: toDocumentDTO(updated),
            version: toVersionDTO(version),
          })),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // uploadVersion
  // -------------------------------------------------------------------------

  uploadVersion(
    rawMeta: UploadVersionMetaEncoded,
    file: File,
  ): Effect.Effect<UploadVersionResult, WorkflowError> {
    return pipe(
      decodeCommand(UploadVersionMetaSchema, rawMeta, DocumentWorkflowError.invalidInput),
      Effect.flatMap((meta) => {
        const now = new Date();
        const verId = crypto.randomUUID();

        return pipe(
          // load doc + version history in parallel
          Effect.all([
            requireActiveDocument(this.documentRepo, meta.documentId),
            pipe(
              this.documentRepo.findVersionsByDocument(meta.documentId),
              Effect.mapError(unavailable("repo.findVersionsByDocument")),
            ),
          ]),
          Effect.map(([document, versions]) => {
            const filename = meta.name?.trim() || file.name || document.name;
            const contentType = file.type || document.contentType;
            const versionNumber =
              versions.length === 0
                ? 1
                : versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
            const bucketKey = buildBucketKey(meta.documentId as string, verId, filename);
            return { document, filename, contentType, versionNumber, bucketKey };
          }),

          // upload
          Effect.flatMap(({ document, filename, contentType, versionNumber, bucketKey }) =>
            pipe(
              Effect.promise(() => file.arrayBuffer()),
              Effect.flatMap((buffer) =>
                pipe(
                  uploadAndHash(this.storage, bucketKey, buffer, contentType),
                  Effect.map((checksum) => ({ document, filename, versionNumber, bucketKey, buffer, checksum })),
                ),
              ),
            ),
          ),

          // save version
          Effect.flatMap(({ document, filename, versionNumber, bucketKey, buffer, checksum }) =>
            pipe(
              DocumentVersion.create({
                id: verId,
                documentId: meta.documentId as string,
                versionNumber,
                bucketKey: bucketKey as string,
                sizeBytes: buffer.byteLength,
                checksum: checksum as string,
                uploadedBy: meta.actor.userId as string,
                createdAt: now.toISOString(),
              }),
              Effect.mapError((e) =>
                DocumentWorkflowError.unavailable("DocumentVersion.create", e),
              ),
              Effect.flatMap((version) =>
                pipe(
                  commitVersion(this.documentRepo, document, version, now),
                  Effect.as({ version, versionNumber, filename }),
                ),
              ),
            ),
          ),

          // emit event
          Effect.tap(({ version, versionNumber, filename }) =>
            emitVersionCreated({
              actorId: meta.actor.userId,
              resourceId: meta.documentId as string,
              versionId: version.id as string,
              versionNumber,
              filename,
            }),
          ),

          Effect.map(({ version }) => ({ version: toVersionDTO(version) })),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  get(raw: GetDocumentQueryEncoded): Effect.Effect<DocumentDTO, WorkflowError> {
    return pipe(
      decodeCommand(GetDocumentQuerySchema, raw, DocumentWorkflowError.invalidInput),
      Effect.flatMap((query) =>
        pipe(
          requireAccessibleDocument(this.documentRepo, query.documentId, query.actor, "read"),
          Effect.map(toDocumentDTO),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  list(raw: ListDocumentsQueryEncoded): Effect.Effect<PaginatedDocumentsDTO, WorkflowError> {
    return pipe(
      decodeCommand(ListDocumentsQuerySchema, raw, DocumentWorkflowError.invalidInput),
      Effect.flatMap((query) => {
        const pagination = parsePagination(query);
        const effectiveOwnerId =
          query.actor.role !== Role.Admin ? query.actor.userId : query.ownerId;
        const search =
          effectiveOwnerId !== undefined
            ? this.documentRepo.findByOwner(effectiveOwnerId, pagination)
            : this.documentRepo.search(query.name?.trim() ?? "", pagination);

        return pipe(
          search,
          Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.listDocuments", e)),
          Effect.map((paginated) => ({
            items: paginated.items.map(toDocumentDTO),
            pageInfo: paginated.pageInfo,
          })),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // download
  // -------------------------------------------------------------------------

  download(raw: DownloadDocumentQueryEncoded): Effect.Effect<PresignedDownloadDTO, WorkflowError> {
    return pipe(
      decodeCommand(DownloadDocumentQuerySchema, raw, DocumentWorkflowError.invalidInput),
      Effect.flatMap((query) => {
        const ttl = query.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS;
        return pipe(
          requireAccessibleDocument(this.documentRepo, query.documentId, query.actor, "download"),
          Effect.flatMap((document) => requireCurrentVersion(this.documentRepo, document)),
          Effect.flatMap((version) => buildPresignedResponse(this.storage, version, ttl)),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // downloadVersion
  // -------------------------------------------------------------------------

  downloadVersion(
    raw: DownloadVersionQueryEncoded,
  ): Effect.Effect<PresignedDownloadDTO, WorkflowError> {
    return pipe(
      decodeCommand(DownloadVersionQuerySchema, raw, DocumentWorkflowError.invalidInput),
      Effect.flatMap((query) => {
        const ttl = query.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS;
        return pipe(
          requireAccessibleDocument(this.documentRepo, query.documentId, query.actor, "download"),
          Effect.flatMap((document) =>
            pipe(
              requireVersion(this.documentRepo, query.versionId),
              Effect.flatMap((version) => requireVersionOfDocument(version, document)),
            ),
          ),
          Effect.flatMap((version) => buildPresignedResponse(this.storage, version, ttl)),
        );
      }),
    );
  }

  // -------------------------------------------------------------------------
  // listVersions
  // -------------------------------------------------------------------------

  listVersions(raw: ListVersionsQueryEncoded): Effect.Effect<readonly VersionDTO[], WorkflowError> {
    return pipe(
      decodeCommand(ListVersionsQuerySchema, raw, DocumentWorkflowError.invalidInput),
      Effect.flatMap((query) =>
        pipe(
          requireAccessibleDocument(
            this.documentRepo,
            query.documentId,
            query.actor,
            "list versions of",
          ),
          Effect.flatMap((document) =>
            pipe(
              this.documentRepo.findVersionsByDocument(document.id),
              Effect.mapError((e) =>
                DocumentWorkflowError.unavailable("repo.findVersionsByDocument", e),
              ),
            ),
          ),
          Effect.map((versions) => versions.map(toVersionDTO)),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  delete(raw: DeleteDocumentCommandEncoded): Effect.Effect<void, WorkflowError> {
    return pipe(
      decodeCommand(DeleteDocumentCommandSchema, raw, DocumentWorkflowError.invalidInput),
      Effect.flatMap((cmd) =>
        pipe(
          assertAdminOnly(cmd.actor, PermissionAction.Delete),
          Effect.flatMap(() => requireDocument(this.documentRepo, cmd.documentId)),
          Effect.flatMap((document) =>
            pipe(
              document.softDelete(),
              Effect.mapError((e) => DocumentWorkflowError.conflict(e.message)),
            ),
          ),
          Effect.flatMap((deleted) =>
            pipe(
              this.documentRepo.update(deleted),
              Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.update", e)),
            ),
          ),
          Effect.tap(() =>
            emitDocumentDeleted({
              actorId: cmd.actor.userId,
              resourceId: cmd.documentId,
            }),
          ),
        ),
      ),
    );
  }
}
