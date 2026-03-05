import { DomainError } from "@domain/utils/base.errors.ts";
import type { DocumentId, VersionId } from "@domain/utils/refined.types.ts";

export enum DocumentErrorTags {
  InvalidContentType = "InvalidContentType",
  DocumentAlreadyDeleted = "DocumentAlreadyDeleted",
  DocumentNotFound = "DocumentNotFound",
  DocumentVersionNotFound = "DocumentVersionNotFound",
}
export class InvalidContentTypeError extends DomainError {
  readonly _tag = DocumentErrorTags.InvalidContentType as const;

  constructor(readonly contentType: string) {
    super(`Content type '${contentType}' is not permitted for document uploads`);
  }
}

/**
 * Raised when an operation that requires an active document
 * (soft-delete, new-version upload, rename, …) is attempted on a document
 * that has already been soft-deleted.
 */
export class DocumentAlreadyDeletedError extends DomainError {
  readonly _tag = DocumentErrorTags.DocumentAlreadyDeleted as const;

  constructor(readonly documentId: DocumentId) {
    super(`Document '${documentId}' has already been deleted and cannot be modified`);
  }
}

/**
 * Raised by the document repository when no document row matches the
 * requested document ID.
 */
export class DocumentNotFoundError extends DomainError {
  readonly _tag = DocumentErrorTags.DocumentNotFound as const;

  constructor(readonly documentId: DocumentId) {
    super(`Document '${documentId}' was not found`);
  }
}

/**
 * Raised by the document repository when no version row matches the
 * requested version ID.
 */
export class DocumentVersionNotFoundError extends DomainError {
  readonly _tag = DocumentErrorTags.DocumentVersionNotFound as const;

  constructor(readonly versionId: VersionId) {
    super(`Document version '${versionId}' was not found`);
  }
}

/**
 * Union of every error that can originate within the document sub-domain.
 * Use this as the error channel type annotation on Effects that touch
 * document entities.
 */
export type DocumentDomainError =
  | InvalidContentTypeError
  | DocumentAlreadyDeletedError
  | DocumentNotFoundError
  | DocumentVersionNotFoundError;
