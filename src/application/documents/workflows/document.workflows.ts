import { inject, injectable } from "tsyringe";
import { Effect as E, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import { DocumentAccessGuard } from "@application/security/document-access.guard.ts";
import {
  requireAccess,
  withVersionTimestamps,
  attachDoc,
  attachChecksum,
  commitFirstDocument,
  resolveVersionCtx,
  attachVersionFile,
  commitVersionCtx,
  softDeleteInCtx,
  persistSoftDelete,
  withCurrentVersionCtx,
  withVersionCtx,
} from "../steps/document.context.steps.ts";
import {
  emitUploadedCtx,
  emitVersionCreatedCtx,
  emitDocumentDeletedCtx,
} from "../emitters/document.events.ts";
import {
  decode,
  withDefaultTtl,
  buildPresignedCtx,
  paginateDocuments,
  fetchVersionsForDocument,
  toUploadResult,
  toVersionDTOList,
} from "../steps/document.workflow.steps.ts";
import { prepareUpload } from "../services/document.upload.ts";
import {
  toDocumentDTO,
  toVersionDTO,
  type DocumentDTO,
  type PaginatedDocumentsDTO,
  type PresignedDownloadDTO,
  type VersionDTO,
  type UploadDocumentResult,
  type UploadVersionResult,
  UploadDocumentMetaSchema,
  UploadVersionMetaSchema,
  GetDocumentQuerySchema,
  ListDocumentsQuerySchema,
  DownloadDocumentQuerySchema,
  DownloadVersionQuerySchema,
  ListVersionsQuerySchema,
  DeleteDocumentCommandSchema,
  type UploadDocumentMetaEncoded,
  type UploadVersionMetaEncoded,
  type GetDocumentQueryEncoded,
  type ListDocumentsQueryEncoded,
  type DownloadDocumentQueryEncoded,
  type DownloadVersionQueryEncoded,
  type ListVersionsQueryEncoded,
  type DeleteDocumentCommandEncoded,
} from "../dtos/document.dto.ts";
import { type DocumentWorkflowError as WorkflowError } from "../document-workflow.errors.ts";

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
      decode(UploadDocumentMetaSchema, rawMeta),
      E.flatMap((meta) => prepareUpload(meta, file)),
      E.flatMap(attachDoc),
      E.flatMap(attachChecksum(this.storage)),
      E.flatMap(commitFirstDocument(this.documentRepo)),
      E.tap(emitUploadedCtx),
      E.map(toUploadResult),
    );
  }

  uploadVersion(
    rawMeta: UploadVersionMetaEncoded,
    file: File,
  ): E.Effect<UploadVersionResult, WorkflowError> {
    return pipe(
      decode(UploadVersionMetaSchema, rawMeta),
      E.map(withVersionTimestamps),
      E.flatMap(requireAccess(this.accessGuard, PermissionAction.Write)),
      E.flatMap(resolveVersionCtx(this.documentRepo, file)),
      E.flatMap(attachVersionFile(this.storage, file)),
      E.flatMap(commitVersionCtx(this.documentRepo)),
      E.tap(emitVersionCreatedCtx),
      E.map(({ version }) => ({ version: toVersionDTO(version) })),
    );
  }

  get(raw: GetDocumentQueryEncoded): E.Effect<DocumentDTO, WorkflowError> {
    return pipe(
      decode(GetDocumentQuerySchema, raw),
      E.flatMap(requireAccess(this.accessGuard, PermissionAction.Read)),
      E.map(({ document }) => toDocumentDTO(document)),
    );
  }

  list(raw: ListDocumentsQueryEncoded): E.Effect<PaginatedDocumentsDTO, WorkflowError> {
    return pipe(
      decode(ListDocumentsQuerySchema, raw),
      E.flatMap(paginateDocuments(this.documentRepo)),
    );
  }

  download(raw: DownloadDocumentQueryEncoded): E.Effect<PresignedDownloadDTO, WorkflowError> {
    return pipe(
      decode(DownloadDocumentQuerySchema, raw),
      E.map(withDefaultTtl),
      E.flatMap(requireAccess(this.accessGuard, PermissionAction.Read)),
      E.flatMap(withCurrentVersionCtx(this.documentRepo)),
      E.flatMap(buildPresignedCtx(this.storage)),
    );
  }

  downloadVersion(raw: DownloadVersionQueryEncoded): E.Effect<PresignedDownloadDTO, WorkflowError> {
    return pipe(
      decode(DownloadVersionQuerySchema, raw),
      E.map(withDefaultTtl),
      E.flatMap(requireAccess(this.accessGuard, PermissionAction.Read)),
      E.flatMap(withVersionCtx(this.documentRepo)),
      E.flatMap(buildPresignedCtx(this.storage)),
    );
  }

  listVersions(raw: ListVersionsQueryEncoded): E.Effect<readonly VersionDTO[], WorkflowError> {
    return pipe(
      decode(ListVersionsQuerySchema, raw),
      E.flatMap(requireAccess(this.accessGuard, PermissionAction.Read)),
      E.flatMap(fetchVersionsForDocument(this.documentRepo)),
      E.map(toVersionDTOList),
    );
  }

  delete(raw: DeleteDocumentCommandEncoded): E.Effect<void, WorkflowError> {
    return pipe(
      decode(DeleteDocumentCommandSchema, raw),
      E.flatMap(requireAccess(this.accessGuard, PermissionAction.Delete)),
      E.flatMap(softDeleteInCtx),
      E.flatMap(persistSoftDelete(this.documentRepo)),
      E.tap(emitDocumentDeletedCtx),
      E.as(undefined),
    );
  }
}
