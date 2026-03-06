import { Effect, pipe } from "effect";
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

// ---------------------------------------------------------------------------
// unavailable — uniform infra-error factory used by all repo wrappers.
// ---------------------------------------------------------------------------

export const unavailable = makeUnavailable(AccessPolicyWorkflowError.unavailable);

// ---------------------------------------------------------------------------
// MANAGE_DENIED — pre-built error value for the policy-manager guard.
// ---------------------------------------------------------------------------

export const MANAGE_DENIED = AccessPolicyWorkflowError.accessDenied(
  "Only the document owner or an admin can manage access policies",
);

// ---------------------------------------------------------------------------
// requireDocForPolicy
// Fetches a document by ID; maps absence to a notFound workflow error.
// ---------------------------------------------------------------------------

export function requireDocForPolicy(
  repo: IDocumentRepository,
  documentId: DocumentId,
): Effect.Effect<Document, WorkflowError> {
  return requireFound(
    repo.findById(documentId),
    unavailable("documentRepo.findById"),
    () => AccessPolicyWorkflowError.notFound(`Document '${documentId}'`),
  );
}

// ---------------------------------------------------------------------------
// requirePolicy
// Fetches a policy by ID; maps absence to a notFound workflow error.
// ---------------------------------------------------------------------------

export function requirePolicy(
  repo: IAccessPolicyRepository,
  policyId: AccessPolicyId,
): Effect.Effect<AccessPolicyType, WorkflowError> {
  return requireFound(
    repo.findById(policyId),
    unavailable("policyRepo.findById"),
    () => AccessPolicyWorkflowError.notFound(`Access policy '${policyId}'`),
  );
}

// ---------------------------------------------------------------------------
// assertPolicyManager
// Guards that the actor is the document owner or an admin.
// Returns the document so it stays in scope for callers that need it.
// ---------------------------------------------------------------------------

export function assertPolicyManager(
  document: Document,
  actor: { readonly userId: UserId; readonly role: Role },
): Effect.Effect<Document, WorkflowError> {
  return assertOrFail(
    actor.role === Role.Admin || isOwner(document, actor.userId),
    document,
    () => MANAGE_DENIED,
  );
}

// ---------------------------------------------------------------------------
// buildPolicy
// Wraps AccessPolicy.create (schema-decoded + validated) and maps a decode
// failure to an InvalidInput workflow error.
// ---------------------------------------------------------------------------

export function buildPolicy(
  input: Parameters<typeof AccessPolicy.create>[0],
  errorMessage: string,
): Effect.Effect<AccessPolicyType, WorkflowError> {
  return pipe(
    AccessPolicy.create(input),
    Effect.mapError(() => AccessPolicyWorkflowError.invalidInput(errorMessage)),
  );
}

// ---------------------------------------------------------------------------
// Event emitters
// Thin Effect.sync wrappers so workflow code never imports eventBus directly.
// ---------------------------------------------------------------------------

export const emitPolicyGranted = (event: AccessPolicyGrantedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(AccessPolicyEvent.Granted, event));

export const emitPolicyUpdated = (event: AccessPolicyUpdatedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(AccessPolicyEvent.Updated, event));

export const emitPolicyRevoked = (event: AccessPolicyRevokedEvent): Effect.Effect<void, never> =>
  Effect.sync(() => eventBus.emit(AccessPolicyEvent.Revoked, event));
