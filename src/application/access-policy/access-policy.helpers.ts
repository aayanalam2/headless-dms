import { Effect as E, pipe } from "effect";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicy as AccessPolicyType } from "@domain/access-policy/access-policy.entity.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { Document } from "@domain/document/document.entity.ts";
import { isOwner } from "@domain/document/document.guards.ts";
import { Role } from "@domain/utils/enums.ts";
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
import {
  makeUnavailable,
  requireFound,
  assertOrFail,
} from "@application/shared/workflow.helpers.ts";

export const unavailable = makeUnavailable(AccessPolicyWorkflowError.unavailable);

export const MANAGE_DENIED = AccessPolicyWorkflowError.accessDenied(
  "Only the document owner or an admin can manage access policies",
);

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

export function assertPolicyManager(
  document: Document,
  actor: { readonly userId: UserId; readonly role: Role },
): E.Effect<Document, WorkflowError> {
  return assertOrFail(
    actor.role === Role.Admin || isOwner(document, actor.userId),
    document,
    () => MANAGE_DENIED,
  );
}

export function buildPolicy(
  input: Parameters<typeof AccessPolicy.create>[0],
  errorMessage: string,
): E.Effect<AccessPolicyType, WorkflowError> {
  return pipe(
    AccessPolicy.create(input),
    E.mapError(() => AccessPolicyWorkflowError.invalidInput(errorMessage)),
  );
}

export const emitPolicyGranted = (event: AccessPolicyGrantedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(AccessPolicyEvent.Granted, event));

export const emitPolicyUpdated = (event: AccessPolicyUpdatedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(AccessPolicyEvent.Updated, event));

export const emitPolicyRevoked = (event: AccessPolicyRevokedEvent): E.Effect<void, never> =>
  E.sync(() => eventBus.emit(AccessPolicyEvent.Revoked, event));
