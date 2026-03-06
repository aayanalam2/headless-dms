import { Effect as E, Option as O, pipe } from "effect";
import {
  BucketKey,
  Checksum,
  type DocumentId,
  type VersionId,
  type UserId,
} from "@domain/utils/refined.types.ts";
import { isOwner } from "@domain/document/document.guards.ts";
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

export function buildBucketKey(documentId: string, versionId: string, filename: string): BucketKey {
  return BucketKey.create(`${documentId}/${versionId}/${encodeURIComponent(filename)}`).unwrap();
}

export function parseTags(raw: O.Option<string>): string[] {
  if (O.isNone(raw) || raw.value.trim().length === 0) return [];
  return raw.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function parseOptionalJson(raw: O.Option<string>): E.Effect<Record<string, string>, Error> {
  if (O.isNone(raw) || raw.value.trim().length === 0) return E.succeed({});
  const str = raw.value;
  return E.try({
    try: () => {
      const parsed: unknown = JSON.parse(str);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("metadata must be a JSON object of string values");
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== "string") {
          throw new Error(`metadata value for "${k}" must be a string`);
        }
      }
      return parsed as Record<string, string>;
    },
    catch: (e) => (e instanceof Error ? e : new Error("metadata must be valid JSON")),
  });
}

export function assertDocumentAccess(
  document: Document,
  actor: { readonly userId: UserId; readonly role: Role },
  action: string,
): E.Effect<Document, WorkflowError> {
  return assertOrFail(actor.role === Role.Admin || isOwner(document, actor.userId), document, () =>
    DocumentWorkflowError.accessDenied(
      `User '${actor.userId}' cannot ${action} document '${document.id}'`,
    ),
  );
}

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
  return version.documentId !== document.id
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
  return O.isNone(document.currentVersionId)
    ? E.fail(
        DocumentWorkflowError.notFound(`Document '${document.id}' has no uploaded version yet`),
      )
    : requireVersion(repo, document.currentVersionId.value);
}

export function parseMetadata(
  raw: string | null | undefined,
): E.Effect<Record<string, string>, WorkflowError> {
  return pipe(
    parseOptionalJson(O.fromNullable(raw)),
    E.mapError(() =>
      DocumentWorkflowError.invalidInput("Metadata must be a valid JSON object of string values"),
    ),
  );
}

export function hashBuffer(buf: ArrayBuffer): E.Effect<Checksum, never> {
  return pipe(
    E.promise(() => crypto.subtle.digest("SHA-256", buf)),
    E.map((hash) => Checksum.create(Buffer.from(hash).toString("hex")).unwrap()),
  );
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
