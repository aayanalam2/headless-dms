import { inject, injectable } from "tsyringe";
import { Effect as E, Schema as S, pipe } from "effect";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";
import { withPagination } from "@application/shared/pagination.ts";
import {
  type BucketKey,
  type Checksum,
  StringToDocumentId,
  StringToVersionId,
} from "@domain/utils/refined.types.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import { BucketKeyFactory } from "@domain/document/value-objects/bucket-key.vo.ts";
import { ChecksumFactory } from "@domain/document/value-objects/checksum.vo.ts";
import { Tags } from "@domain/document/value-objects/tags.vo.ts";
import { Metadata } from "@domain/document/value-objects/metadata.vo.ts";
import {
  commitVersion,
  requireAccessibleDocument,
  requireVersion,
  requireVersionOfDocument,
  requireCurrentVersion,
  emitDocumentUploaded,
  emitVersionCreated,
  emitDocumentDeleted,
} from "./document.helpers.ts";
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

const unavailable =
  (op: string) =>
  (e: unknown): WorkflowError =>
    DocumentWorkflowError.unavailable(op, e);

function uploadAndHash(
  storage: IStorage,
  bucketKey: BucketKey,
  buffer: ArrayBuffer,
  contentType: string,
): E.Effect<Checksum, WorkflowError> {
  return pipe(
    E.all([
      ChecksumFactory.fromBuffer(buffer),
      pipe(
        storage.uploadFile(bucketKey, Buffer.from(buffer), contentType),
        E.mapError(unavailable("storage.uploadFile")),
      ),
    ]),
    E.map(([checksum]) => checksum),
  );
}

function buildPresignedResponse(
  storage: IStorage,
  version: DocumentVersion,
  ttl: number,
): E.Effect<PresignedDownloadDTO, WorkflowError> {
  return pipe(
    storage.getPresignedDownloadUrl(version.bucketKey, ttl),
    E.mapError((e) => DocumentWorkflowError.unavailable("storage.getPresignedDownloadUrl", e)),
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
    @inject(TOKENS.AccessPolicyRepository) private readonly policyRepo: IAccessPolicyRepository,
  ) {}

  upload(
    rawMeta: UploadDocumentMetaEncoded,
    file: File,
  ): E.Effect<UploadDocumentResult, WorkflowError> {
    return pipe(
      decodeCommand(UploadDocumentMetaSchema, rawMeta, DocumentWorkflowError.invalidInput),
      E.flatMap((meta) => {
        const now = new Date();
        const docId = S.decodeSync(StringToDocumentId)(crypto.randomUUID());
        const verId = S.decodeSync(StringToVersionId)(crypto.randomUUID());
        const filename = meta.name?.trim() || file.name || "untitled";
        const bucketKey = BucketKeyFactory.forVersion(docId, verId, filename);

        return pipe(
          E.all([
            pipe(
              Metadata.parse(meta.rawMetadata),
              E.map((m) => m.value),
              E.mapError(() =>
                DocumentWorkflowError.invalidInput(
                  "Metadata must be a valid JSON object of string values",
                ),
              ),
            ),
            E.promise(() => file.arrayBuffer()),
          ]),
          E.map(([metadata, buffer]) => ({
            metadata,
            buffer,
            tags: Tags.parse(meta.rawTags).value,
          })),

          E.flatMap(({ metadata, buffer, tags }) =>
            pipe(
              Document.createNew({
                id: docId,
                ownerId: meta.actor.userId,
                name: filename,
                contentType: file.type,
                tags,
                metadata,
                createdAt: now,
                updatedAt: now,
              }),
              E.mapError((e) => DocumentWorkflowError.invalidContentType(e.contentType)),
              E.map((doc) => ({ doc, buffer })),
            ),
          ),

          E.flatMap(({ doc, buffer }) =>
            pipe(
              uploadAndHash(this.storage, bucketKey, buffer, doc.contentType),
              E.map((checksum) => ({ doc, buffer, checksum })),
            ),
          ),

          E.flatMap(({ doc, buffer, checksum }) => {
            const version = DocumentVersion.createNew({
              id: verId,
              documentId: docId,
              versionNumber: 1,
              bucketKey: bucketKey,
              sizeBytes: buffer.byteLength,
              checksum: checksum,
              uploadedBy: meta.actor.userId,
              createdAt: now,
            });
            return pipe(
              doc.setCurrentVersion(version.id, now),
              E.mapError((e) => DocumentWorkflowError.conflict(e.message)),
              E.flatMap((updatedDoc) =>
                pipe(
                  this.documentRepo.insertDocumentWithVersion(doc, version, updatedDoc),
                  E.mapError((e) =>
                    DocumentWorkflowError.unavailable("repo.insertDocumentWithVersion", e),
                  ),
                  E.as({ version, updated: updatedDoc }),
                ),
              ),
            );
          }),

          E.tap(({ updated, version }) =>
            emitDocumentUploaded({
              actorId: meta.actor.userId,
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
      }),
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
        const verId = S.decodeSync(StringToVersionId)(crypto.randomUUID());

        return pipe(
          requireAccessibleDocument(
            this.documentRepo,
            this.policyRepo,
            meta.documentId,
            meta.actor,
            PermissionAction.Write,
          ),
          E.flatMap((document) =>
            pipe(
              this.documentRepo.findVersionsByDocument(meta.documentId),
              E.mapError(unavailable("repo.findVersionsByDocument")),
              E.map((versions) => {
                const filename = meta.name?.trim() || file.name || document.name;
                const contentType = file.type || document.contentType;
                const versionNumber = DocumentVersion.nextNumber(versions);
                const bucketKey = BucketKeyFactory.forVersion(meta.documentId, verId, filename);
                return { document, filename, contentType, versionNumber, bucketKey };
              }),
            ),
          ),

          E.flatMap(({ document, filename, contentType, versionNumber, bucketKey }) =>
            pipe(
              E.promise(() => file.arrayBuffer()),
              E.flatMap((buffer) =>
                pipe(
                  uploadAndHash(this.storage, bucketKey, buffer, contentType),
                  E.map((checksum) => ({
                    document,
                    filename,
                    versionNumber,
                    bucketKey,
                    buffer,
                    checksum,
                  })),
                ),
              ),
            ),
          ),

          E.flatMap(({ document, filename, versionNumber, bucketKey, buffer, checksum }) => {
            const version = DocumentVersion.createNew({
              id: verId,
              documentId: meta.documentId,
              versionNumber,
              bucketKey: bucketKey,
              sizeBytes: buffer.byteLength,
              checksum: checksum,
              uploadedBy: meta.actor.userId,
              createdAt: now,
            });
            return pipe(
              commitVersion(this.documentRepo, document, version, now),
              E.as({ version, versionNumber, filename }),
            );
          }),

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
          requireAccessibleDocument(
            this.documentRepo,
            this.policyRepo,
            query.documentId,
            query.actor,
            PermissionAction.Read,
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
          (pagination) => {
            const effectiveOwnerId =
              query.actor.role !== Role.Admin ? query.actor.userId : query.ownerId;
            const search =
              effectiveOwnerId !== undefined
                ? this.documentRepo.findByOwner(effectiveOwnerId, pagination)
                : this.documentRepo.search(query.name?.trim() ?? "", pagination);
            return pipe(
              search,
              E.mapError((e) => DocumentWorkflowError.unavailable("repo.listDocuments", e)),
            );
          },
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
          requireAccessibleDocument(
            this.documentRepo,
            this.policyRepo,
            query.documentId,
            query.actor,
            PermissionAction.Read,
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
          requireAccessibleDocument(
            this.documentRepo,
            this.policyRepo,
            query.documentId,
            query.actor,
            PermissionAction.Read,
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
          requireAccessibleDocument(
            this.documentRepo,
            this.policyRepo,
            query.documentId,
            query.actor,
            PermissionAction.Read,
          ),
          E.flatMap((document) =>
            pipe(
              this.documentRepo.findVersionsByDocument(document.id),
              E.mapError((e) =>
                DocumentWorkflowError.unavailable("repo.findVersionsByDocument", e),
              ),
            ),
          ),
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
          requireAccessibleDocument(
            this.documentRepo,
            this.policyRepo,
            cmd.documentId,
            cmd.actor,
            PermissionAction.Delete,
          ),
          E.flatMap((document) =>
            pipe(
              document.softDelete(),
              E.mapError((e) => DocumentWorkflowError.conflict(e.message)),
            ),
          ),
          E.flatMap((deleted) =>
            pipe(
              this.documentRepo.softDelete(deleted),
              E.mapError((e) => DocumentWorkflowError.unavailable("repo.softDelete", e)),
            ),
          ),
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
