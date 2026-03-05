import { inject, injectable } from "tsyringe";
import type { Effect } from "effect";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { uploadDocument } from "./workflows/upload-document.workflow.ts";
import { uploadVersion } from "./workflows/upload-version.workflow.ts";
import { getDocument } from "./workflows/get-document.workflow.ts";
import { listDocuments } from "./workflows/list-documents.workflow.ts";
import { downloadDocument } from "./workflows/download-document.workflow.ts";
import { downloadVersion } from "./workflows/download-version.workflow.ts";
import { listVersions } from "./workflows/list-versions.workflow.ts";
import { deleteDocument } from "./workflows/delete-document.workflow.ts";
import type {
  UploadDocumentMetaEncoded,
  UploadVersionMetaEncoded,
  GetDocumentQueryEncoded,
  ListDocumentsQueryEncoded,
  DownloadDocumentQueryEncoded,
  DownloadVersionQueryEncoded,
  ListVersionsQueryEncoded,
  DeleteDocumentCommandEncoded,
} from "./dtos/commands.dto.ts";
import type { DocumentWorkflowError } from "./document-workflow.errors.ts";
import type { UploadDocumentResult } from "./workflows/upload-document.workflow.ts";
import type { UploadVersionResult } from "./workflows/upload-version.workflow.ts";
import type {
  DocumentDTO,
  PaginatedDocumentsDTO,
  PresignedDownloadDTO,
  VersionDTO,
} from "./dtos/document.dto.ts";

// ---------------------------------------------------------------------------
// DocumentWorkflows — injectable application service wrapping all document
// workflow functions.  Controllers receive this class via DI instead of
// building raw deps objects manually.
// ---------------------------------------------------------------------------

@injectable()
export class DocumentWorkflows {
  private readonly deps: { documentRepo: IDocumentRepository; storage: IStorage };

  constructor(
    @inject(TOKENS.DocumentRepository) private readonly documentRepo: IDocumentRepository,
    @inject(TOKENS.StorageService) private readonly storage: IStorage,
  ) {
    this.deps = { documentRepo, storage };
  }

  upload(
    rawMeta: UploadDocumentMetaEncoded,
    file: File,
  ): Effect.Effect<UploadDocumentResult, DocumentWorkflowError> {
    return uploadDocument(this.deps, rawMeta, file);
  }

  uploadVersion(
    rawMeta: UploadVersionMetaEncoded,
    file: File,
  ): Effect.Effect<UploadVersionResult, DocumentWorkflowError> {
    return uploadVersion(this.deps, rawMeta, file);
  }

  get(raw: GetDocumentQueryEncoded): Effect.Effect<DocumentDTO, DocumentWorkflowError> {
    return getDocument({ documentRepo: this.documentRepo }, raw);
  }

  list(raw: ListDocumentsQueryEncoded): Effect.Effect<PaginatedDocumentsDTO, DocumentWorkflowError> {
    return listDocuments({ documentRepo: this.documentRepo }, raw);
  }

  download(raw: DownloadDocumentQueryEncoded): Effect.Effect<PresignedDownloadDTO, DocumentWorkflowError> {
    return downloadDocument(this.deps, raw);
  }

  downloadVersion(raw: DownloadVersionQueryEncoded): Effect.Effect<PresignedDownloadDTO, DocumentWorkflowError> {
    return downloadVersion(this.deps, raw);
  }

  listVersions(raw: ListVersionsQueryEncoded): Effect.Effect<readonly VersionDTO[], DocumentWorkflowError> {
    return listVersions({ documentRepo: this.documentRepo }, raw);
  }

  delete(raw: DeleteDocumentCommandEncoded): Effect.Effect<void, DocumentWorkflowError> {
    return deleteDocument({ documentRepo: this.documentRepo }, raw);
  }
}
