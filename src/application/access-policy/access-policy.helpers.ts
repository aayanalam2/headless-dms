import { Effect as E, pipe } from "effect";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyType } from "@domain/access-policy/access-policy.entity.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { Document } from "@domain/document/document.entity.ts";
import { Role } from "@domain/utils/enums.ts";
import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import type { UserId, AccessPolicyId, DocumentId } from "@domain/utils/refined.types.ts";
import {
  AccessPolicyEvent,
  type AccessPolicyGrantedEvent,
  type AccessPolicyUpdatedEvent,
  type AccessPolicyRevokedEvent,
} from "@domain/events/access-policy.events.ts";
import { eventBus } from "@infra/event-bus.ts";
import {
  AccessPolicyWorkflowError,
  type AccessPolicyWorkflowError as WorkflowError,
} from "./access-policy-workflow.errors.ts";
import { makeUnavailable, requireFound } from "@application/shared/workflow.helpers.ts";

export const unavailable = makeUnavailable(AccessPolicyWorkflowError.unavailable);

export function requireDocForPolicy(
  repo: IDocumentRepository,
  documentId: DocumentId,
): E.Effect<Document, WorkflowError> {
  return requireFound(repo.findById(documentId), unavailable("documentRepo.findById"), () =>
    AccessPolicyWorkflowError.notFound(`Document '${documentId}'`),
  );
}

export function requirePolicy(
  repo: IAccessPolicyRepository,
  policyId: AccessPolicyId,
): E.Effect<AccessPolicyType, WorkflowError> {
  return requireFound(repo.findById(policyId), unavailable("policyRepo.findById"), () =>
    AccessPolicyWorkflowError.notFound(`Access policy '${policyId}'`),
  );
}

export function requireShareableDocument(
  docRepo: IDocumentRepository,
  policyRepo: IAccessPolicyRepository,
  documentId: DocumentId,
  actor: { readonly userId: UserId; readonly role: Role },
): E.Effect<Document, WorkflowError> {
  return pipe(
    requireDocForPolicy(docRepo, documentId),
    E.flatMap((document) =>
      pipe(
        policyRepo.findByDocumentAndSubject(documentId, actor.userId),
        E.mapError(unavailable("policyRepo.findByDocumentAndSubject")),
        E.flatMap((policies) =>
          DocumentAccessService.evaluate(
            { id: actor.userId, role: actor.role },
            policies,
            document,
            PermissionAction.Share,
          )
            ? E.succeed(document)
            : E.fail(
                AccessPolicyWorkflowError.accessDenied(
                  `User '${actor.userId}' cannot manage policies for document '${documentId}'`,
                ),
              ),
        ),
      ),
    ),
  );
}

export function buildPolicy(
  input: AccessPolicyType,
  _errorMessage: string,
): E.Effect<AccessPolicy, WorkflowError> {
  return E.succeed(AccessPolicy.createNew(input));
}

export const emitPolicyGranted = (event: AccessPolicyGrantedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(AccessPolicyEvent.Granted, event));

export const emitPolicyUpdated = (event: AccessPolicyUpdatedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(AccessPolicyEvent.Updated, event));

export const emitPolicyRevoked = (event: AccessPolicyRevokedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(AccessPolicyEvent.Revoked, event));
