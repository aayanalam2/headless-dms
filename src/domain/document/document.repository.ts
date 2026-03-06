import type { Option as O } from "effect";
import type { Document } from "@domain/document/document.entity.ts";
import type { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { DocumentId, UserId, VersionId } from "@domain/utils/refined.types.ts";
import type {
  DocumentNotFoundError,
  DocumentVersionNotFoundError,
} from "@domain/document/document.errors.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";
import type { Paginated, PaginationParams } from "@domain/utils/pagination.ts";

// ---------------------------------------------------------------------------
// IDocumentRepository — persistence port for Document aggregates
// ---------------------------------------------------------------------------

export interface IDocumentRepository {
  findById(id: DocumentId): RepositoryEffect<O.Option<Document>>;

  findActiveById(id: DocumentId): RepositoryEffect<O.Option<Document>>;

  findByOwner(ownerId: UserId, pagination: PaginationParams): RepositoryEffect<Paginated<Document>>;

  search(query: string, pagination: PaginationParams): RepositoryEffect<Paginated<Document>>;

  // -------------------------------------------------------------------------
  // Version sub-queries
  // -------------------------------------------------------------------------

  /**
   * List all versions for a document in ascending version-number order.
   */
  findVersionsByDocument(documentId: DocumentId): RepositoryEffect<readonly DocumentVersion[]>;

  /**
   * Find a single version by its primary key.
   */
  findVersionById(versionId: VersionId): RepositoryEffect<O.Option<DocumentVersion>>;

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Atomically INSERT a version row and UPDATE the document's currentVersionId
   * in a single transaction.
   */
  insertVersionAndUpdate(version: DocumentVersion, updatedDoc: Document): RepositoryEffect<void>;

  /**
   * Atomically INSERT the document row, INSERT its first version row, and
   * UPDATE the document's currentVersionId in a single transaction.
   */
  insertDocumentWithVersion(
    doc: Document,
    version: DocumentVersion,
    updatedDoc: Document,
  ): RepositoryEffect<void>;

  /**
   * Soft-delete a document by stamping deletedAt. Fails if the document row
   * does not exist.
   */
  softDelete(document: Document): RepositoryEffect<void, DocumentNotFoundError>;

  /**
   * Physically remove a document version row (used when an upload is aborted
   * or the version was never committed).
   */
  deleteVersion(versionId: VersionId): RepositoryEffect<void, DocumentVersionNotFoundError>;
}
