import { inject, injectable } from "tsyringe";
import { Effect as E, pipe } from "effect";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { withPagination } from "@application/shared/pagination.ts";
import { newVersionId } from "@domain/utils/refined.types.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import { DocumentAccessGuard } from "@application/security/document-access.guard.ts";
import {
  liftRepo,
  liftConflict,
  requireVersion,
  requireVersionOfDocument,
  requireCurrentVersion,
  scopeList,
  emitDocumentUploaded,
  emitVersionCreated,
  emitDocumentDeleted,
} from "./document.helpers.ts";
import {
  uploadAndHash,
  uploadFile,
  resolveVersionMeta,
  buildAndCommitVersion,
  buildAndCommitFirstDocument,
  prepareUpload,
  buildDocument,
} from "./document.service.ts";
import {
  toDocumentDTO,
  toPaginatedDocumentsDTO,
  toVersionDTO,
  type DocumentDTO,
  type PaginatedDocumentsDTO,
  type PresignedDownloadDTO,
  type VersionDTO,
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
} from "./dtos/document.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "./document-workflow.errors.ts";

export type UploadDocumentResult = {
  readonly document: DocumentDTO;
  readonly version: VersionDTO;
};

export type UploadVersionResult = { readonly version: VersionDTO };

function buildPresignedResponse(
  storage: IStorage,
  version: DocumentVersion,
  ttl: number,
): E.Effect<PresignedDownloadDTO, WorkflowError> {
  return pipe(
    storage.getPresignedDownloadUrl(version.bucketKey, ttl),
    E.mapError((e) => DocumentWorkflowError.unavailable(e)),
    E.map((url) => ({
      url,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      version: toVersionDTO(version),
    })),
  );
}

@injectable()
export class DocumentWorkflows {
  constructor(
    @inject(TOKENS.DocumentRepository) private readonly documentRepo: IDocumentRepository,
    @inject(TOKENS.StorageService) private readonly storage: IStorage,
    @inject(TOKENS.DocumentAccessGuard) private readonly accessGuard: DocumentAccessGuard,
  ) {}

  upload(
    rawMeta: UploadDocumentMetaEncoded,
    file: File,
  ): E.Effect<UploadDocumentResult, WorkflowError> {
    return pipe(
      decodeCommand(UploadDocumentMetaSchema, rawMeta, DocumentWorkflowError.invalidInput),
      E.flatMap((meta) => prepareUpload(meta, file)),
      E.flatMap((ctx) => E.map(buildDocument(ctx), (doc) => ({ ...ctx, doc }))),
      E.flatMap(({ doc, buffer, bucketKey, verId, actorId, now, filename }) =>
        E.map(uploadAndHash(this.storage, bucketKey, buffer, doc.contentType), (checksum) => ({
          doc,
          buffer,
          checksum,
          bucketKey,
          verId,
          actorId,
          now,
          filename,
        })),
      ),
      E.flatMap(({ doc, verId, bucketKey, buffer, checksum, actorId, now, filename }) =>
        E.map(
          buildAndCommitFirstDocument(
            this.documentRepo,
            doc,
            verId,
            bucketKey,
            buffer,
            checksum,
            actorId,
            now,
          ),
          ({ version, updated }) => ({ version, updated, filename, actorId }),
        ),
      ),
      E.tap(({ updated, version, filename, actorId }) =>
        emitDocumentUploaded({
          actorId,
          resourceId: updated.id,
          versionId: version.id,
          filename,
          contentType: updated.contentType,
        }),
      ),
      E.map(({ updated, version }) => ({
        document: toDocumentDTO(updated),
        version: toVersionDTO(version),
      })),
    );
  }

  uploadVersion(
    rawMeta: UploadVersionMetaEncoded,
    file: File,
  ): E.Effect<UploadVersionResult, WorkflowError> {
    return pipe(
      decodeCommand(UploadVersionMetaSchema, rawMeta, DocumentWorkflowError.invalidInput),
      E.flatMap((meta) => {
        const now = new Date();
        const verId = newVersionId();

        return pipe(
          this.accessGuard.require(
            meta.documentId,
            meta.actor,
            PermissionAction.Write,
            DocumentWorkflowError,
          ),
          E.flatMap((document) =>
            resolveVersionMeta(
              this.documentRepo,
              meta.documentId,
              verId,
              meta.name,
              file,
              document,
            ),
          ),
          E.flatMap((ctx) =>
            E.map(uploadFile(this.storage, file, ctx.bucketKey, ctx.contentType), (hash) => ({
              ...ctx,
              ...hash,
            })),
          ),
          E.flatMap((ctx) =>
            buildAndCommitVersion(
              this.documentRepo,
              verId,
              meta.documentId,
              meta.actor.userId,
              now,
              ctx,
            ),
          ),
          E.tap(({ version, versionNumber, filename }) =>
            emitVersionCreated({
              actorId: meta.actor.userId,
              resourceId: meta.documentId,
              versionId: version.id,
              versionNumber,
              filename,
            }),
          ),
          E.map(({ version }) => ({ version: toVersionDTO(version) })),
        );
      }),
    );
  }

  get(raw: GetDocumentQueryEncoded): E.Effect<DocumentDTO, WorkflowError> {
    return pipe(
      decodeCommand(GetDocumentQuerySchema, raw, DocumentWorkflowError.invalidInput),
      E.flatMap((query) =>
        pipe(
          this.accessGuard.require(
            query.documentId,
            query.actor,
            PermissionAction.Read,
            DocumentWorkflowError,
          ),
          E.map(toDocumentDTO),
        ),
      ),
    );
  }

  list(raw: ListDocumentsQueryEncoded): E.Effect<PaginatedDocumentsDTO, WorkflowError> {
    return pipe(
      decodeCommand(ListDocumentsQuerySchema, raw, DocumentWorkflowError.invalidInput),
      E.flatMap((query) =>
        withPagination(
          query,
          (pagination) =>
            liftRepo(
              scopeList(
                this.documentRepo,
                query.actor,
                { ownerId: query.ownerId, name: query.name },
                pagination,
              ),
            ),
          toPaginatedDocumentsDTO,
        ),
      ),
    );
  }

  download(raw: DownloadDocumentQueryEncoded): E.Effect<PresignedDownloadDTO, WorkflowError> {
    return pipe(
      decodeCommand(DownloadDocumentQuerySchema, raw, DocumentWorkflowError.invalidInput),
      E.flatMap((query) => {
        const ttl = query.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS;
        return pipe(
          this.accessGuard.require(
            query.documentId,
            query.actor,
            PermissionAction.Read,
            DocumentWorkflowError,
          ),
          E.flatMap((document) => requireCurrentVersion(this.documentRepo, document)),
          E.flatMap((version) => buildPresignedResponse(this.storage, version, ttl)),
        );
      }),
    );
  }

  downloadVersion(raw: DownloadVersionQueryEncoded): E.Effect<PresignedDownloadDTO, WorkflowError> {
    return pipe(
      decodeCommand(DownloadVersionQuerySchema, raw, DocumentWorkflowError.invalidInput),
      E.flatMap((query) => {
        const ttl = query.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS;
        return pipe(
          this.accessGuard.require(
            query.documentId,
            query.actor,
            PermissionAction.Read,
            DocumentWorkflowError,
          ),
          E.flatMap((document) =>
            pipe(
              requireVersion(this.documentRepo, query.versionId),
              E.flatMap((version) => requireVersionOfDocument(version, document)),
            ),
          ),
          E.flatMap((version) => buildPresignedResponse(this.storage, version, ttl)),
        );
      }),
    );
  }

  listVersions(raw: ListVersionsQueryEncoded): E.Effect<readonly VersionDTO[], WorkflowError> {
    return pipe(
      decodeCommand(ListVersionsQuerySchema, raw, DocumentWorkflowError.invalidInput),
      E.flatMap((query) =>
        pipe(
          this.accessGuard.require(
            query.documentId,
            query.actor,
            PermissionAction.Read,
            DocumentWorkflowError,
          ),
          E.flatMap((document) => liftRepo(this.documentRepo.findVersionsByDocument(document.id))),
          E.map((versions) => versions.map(toVersionDTO)),
        ),
      ),
    );
  }

  delete(raw: DeleteDocumentCommandEncoded): E.Effect<void, WorkflowError> {
    return pipe(
      decodeCommand(DeleteDocumentCommandSchema, raw, DocumentWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          this.accessGuard.require(
            cmd.documentId,
            cmd.actor,
            PermissionAction.Delete,
            DocumentWorkflowError,
          ),
          E.flatMap((document) => liftConflict(document.softDelete())),
          E.flatMap((deleted) => liftRepo(this.documentRepo.softDelete(deleted))),
          E.tap(() =>
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
