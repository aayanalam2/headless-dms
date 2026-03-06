import { Effect as E, Option as O, pipe } from "effect";
import {
  type DocumentId,
  type VersionId,
  type UserId,
} from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import type { Document } from "@domain/document/document.entity.ts";
import type { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { eventBus } from "@infra/event-bus.ts";
import {
  DocumentEvent,
  type DocumentUploadedEvent,
  type DocumentVersionCreatedEvent,
  type DocumentDeletedEvent,
} from "@domain/events/document.events.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "./document-workflow.errors.ts";
import {
  makeUnavailable,
  requireFound,
  assertOrFail,
  assertGuard,
} from "@application/shared/workflow.helpers.ts";

const unavailable = makeUnavailable(DocumentWorkflowError.unavailable);

export function assertAdminOnly(
  actor: { readonly userId: UserId; readonly role: Role },
  action: string,
): E.Effect<void, WorkflowError> {
  return assertGuard(actor.role === Role.Admin, () =>
    DocumentWorkflowError.accessDenied(
      `User '${actor.userId}' does not have '${action}' permission`,
    ),
  );
}

export function requireDocument(
  repo: IDocumentRepository,
  documentId: DocumentId,
): E.Effect<Document, WorkflowError> {
  return requireFound(repo.findById(documentId), unavailable("repo.findById"), () =>
    DocumentWorkflowError.notFound(`Document '${documentId}'`),
  );
}

export function requireActiveDocument(
  repo: IDocumentRepository,
  documentId: DocumentId,
): E.Effect<Document, WorkflowError> {
  return requireFound(repo.findActiveById(documentId), unavailable("repo.findActiveById"), () =>
    DocumentWorkflowError.notFound(`Document '${documentId}'`),
  );
}

export function requireVersion(
  repo: IDocumentRepository,
  versionId: VersionId,
): E.Effect<DocumentVersion, WorkflowError> {
  return requireFound(repo.findVersionById(versionId), unavailable("repo.findVersionById"), () =>
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
  const versionId = O.getOrNull(document.currentVersionId);
  if (!document.hasVersions || versionId === null) {
    return E.fail(
      DocumentWorkflowError.notFound(`Document '${document.id}' has no uploaded version yet`),
    );
  }
  return requireVersion(repo, versionId);
}

export function commitVersion(
  repo: IDocumentRepository,
  doc: Document,
  version: DocumentVersion,
  now: Date,
): E.Effect<{ readonly version: DocumentVersion; readonly updated: Document }, WorkflowError> {
  return pipe(
    doc.setCurrentVersion(version.id, now),
    E.mapError((e) => DocumentWorkflowError.conflict(e.message)),
    E.flatMap((updatedDoc) =>
      pipe(
        repo.insertVersionAndUpdate(version, updatedDoc),
        E.mapError((e) => DocumentWorkflowError.unavailable("repo.insertVersionAndUpdate", e)),
        E.as({ version, updated: updatedDoc }),
      ),
    ),
  );
}

export function requireAccessibleDocument(
  repo: IDocumentRepository,
  policyRepo: IAccessPolicyRepository,
  userRepo: IUserRepository,
  documentId: DocumentId,
  actor: { readonly userId: UserId; readonly role: Role },
  action: PermissionAction,
): E.Effect<Document, WorkflowError> {
  return pipe(
    requireActiveDocument(repo, documentId),
    E.flatMap((document) =>
      pipe(
        E.all(
          {
            userOpt: pipe(
              userRepo.findById(actor.userId),
              E.mapError((e) => DocumentWorkflowError.unavailable("userRepo.findById", e)),
            ),
            subjectPolicies: pipe(
              policyRepo.findByDocumentAndSubject(documentId, actor.userId),
              E.mapError((e) =>
                DocumentWorkflowError.unavailable("policyRepo.findByDocumentAndSubject", e),
              ),
            ),
            rolePolicies: pipe(
              policyRepo.findByDocumentAndRole(documentId, actor.role),
              E.mapError((e) =>
                DocumentWorkflowError.unavailable("policyRepo.findByDocumentAndRole", e),
              ),
            ),
          },
          { concurrency: 3 },
        ),
        E.flatMap(({ userOpt, subjectPolicies, rolePolicies }) => {
          if (O.isNone(userOpt)) {
            return E.fail(DocumentWorkflowError.notFound(`User '${actor.userId}'`));
          }
          const user = userOpt.value;
          const policies = [...subjectPolicies, ...rolePolicies];
          return DocumentAccessService.evaluate(user, policies, document, action)
            ? E.succeed(document)
            : E.fail(
                DocumentWorkflowError.accessDenied(
                  `User '${actor.userId}' cannot ${action} document '${document.id}'`,
                ),
              );
        }),
      ),
    ),
  );
}

export const emitDocumentUploaded = (event: DocumentUploadedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(DocumentEvent.Uploaded, event));

export const emitVersionCreated = (event: DocumentVersionCreatedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(DocumentEvent.VersionCreated, event));

export const emitDocumentDeleted = (event: DocumentDeletedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(DocumentEvent.Deleted, event));
