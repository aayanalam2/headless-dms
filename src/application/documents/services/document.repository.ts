import { Effect as E, pipe } from "effect";
import {
  type DocumentId,
  type VersionId,
  type UserId,
} from "@domain/utils/refined.types.ts";
import { optionToMaybe } from "@domain/utils/utils.ts";
import { Role } from "@domain/utils/enums.ts";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { Paginated, PaginationParams } from "@domain/utils/pagination.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";
import type { Actor } from "@application/shared/actor.ts";
import {
  makeLiftRepo,
  makeLiftConflict,
  requireFound,
} from "@application/shared/workflow.helpers.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Lifted error constructors
// ---------------------------------------------------------------------------

/** Lift any effect's error to Unavailable. Intended for repository and storage calls. */
export const liftRepo = makeLiftRepo(DocumentWorkflowError.unavailable);

/** Lift a domain Effect whose error has a `message` field to a Conflict error. */
export const liftConflict = makeLiftConflict(DocumentWorkflowError.conflict);

// ---------------------------------------------------------------------------
// List scoping
// ---------------------------------------------------------------------------

/**
 * Resolves which repository query to run for a list operation based on the
 * actor's role. Admins can browse globally (filtered by owner or name);
 * all other actors see only documents accessible to them.
 */
export function scopeList(
  repo: IDocumentRepository,
  actor: Actor,
  filters: { readonly ownerId?: UserId | undefined; readonly name?: string | undefined },
  pagination: PaginationParams,
): RepositoryEffect<Paginated<Document>> {
  if (actor.role === Role.Admin) {
    return filters.ownerId !== undefined
      ? repo.findByOwner(filters.ownerId, pagination)
      : repo.search(filters.name?.trim() ?? "", pagination);
  }
  return repo.findAccessible(actor.userId, pagination);
}

// ---------------------------------------------------------------------------
// Document lookups
// ---------------------------------------------------------------------------

export function requireDocument(
  repo: IDocumentRepository,
  documentId: DocumentId,
): E.Effect<Document, WorkflowError> {
  return requireFound(repo.findById(documentId), DocumentWorkflowError.unavailable, () =>
    DocumentWorkflowError.notFound(`Document '${documentId}'`),
  );
}

export function requireActiveDocument(
  repo: IDocumentRepository,
  documentId: DocumentId,
): E.Effect<Document, WorkflowError> {
  return requireFound(repo.findActiveById(documentId), DocumentWorkflowError.unavailable, () =>
    DocumentWorkflowError.notFound(`Document '${documentId}'`),
  );
}

export function requireVersion(
  repo: IDocumentRepository,
  versionId: VersionId,
): E.Effect<DocumentVersion, WorkflowError> {
  return requireFound(repo.findVersionById(versionId), DocumentWorkflowError.unavailable, () =>
    DocumentWorkflowError.notFound(`Version '${versionId}'`),
  );
}

export function requireVersionOfDocument(
  version: DocumentVersion,
  document: Document,
): E.Effect<DocumentVersion, WorkflowError> {
  return !version.belongsTo(document.id)
    ? E.fail(
        DocumentWorkflowError.notFound(
          `Version '${version.id}' does not belong to document '${document.id}'`,
        ),
      )
    : E.succeed(version);
}

export function requireCurrentVersion(
  repo: IDocumentRepository,
  document: Document,
): E.Effect<DocumentVersion, WorkflowError> {
  const versionId = optionToMaybe(document.currentVersionId);
  if (!document.hasVersions || versionId === null) {
    return E.fail(
      DocumentWorkflowError.notFound(`Document '${document.id}' has no uploaded version yet`),
    );
  }
  return requireVersion(repo, versionId);
}

// ---------------------------------------------------------------------------
// Commit helpers
// ---------------------------------------------------------------------------

export function commitVersion(
  repo: IDocumentRepository,
  doc: Document,
  version: DocumentVersion,
  now: Date,
): E.Effect<{ readonly version: DocumentVersion; readonly updated: Document }, WorkflowError> {
  return pipe(
    liftConflict(doc.setCurrentVersion(version.id, now)),
    E.flatMap((updatedDoc) =>
      E.as(liftRepo(repo.insertVersionAndUpdate(version, updatedDoc)), {
        version,
        updated: updatedDoc,
      }),
    ),
  );
}

export function commitNewDocument(
  repo: IDocumentRepository,
  doc: Document,
  version: DocumentVersion,
  now: Date,
): E.Effect<{ readonly version: DocumentVersion; readonly updated: Document }, WorkflowError> {
  return pipe(
    liftConflict(doc.setCurrentVersion(version.id, now)),
    E.flatMap((updatedDoc) =>
      E.as(liftRepo(repo.insertDocumentWithVersion(doc, version, updatedDoc)), {
        version,
        updated: updatedDoc,
      }),
    ),
  );
}
