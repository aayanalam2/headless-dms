import { Effect as E } from "effect";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyType } from "@domain/access-policy/access-policy.entity.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { AccessPolicyId } from "@domain/utils/refined.types.ts";
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
  makeLiftRepo,
  requireFound,
} from "@application/shared/workflow.helpers.ts";

export const unavailable = makeUnavailable(AccessPolicyWorkflowError.unavailable);
export const liftRepo = makeLiftRepo(AccessPolicyWorkflowError.unavailable);

export function requirePolicy(
  repo: IAccessPolicyRepository,
  policyId: AccessPolicyId,
): E.Effect<AccessPolicyType, WorkflowError> {
  return requireFound(repo.findById(policyId), unavailable("policyRepo.findById"), () =>
    AccessPolicyWorkflowError.notFound(`Access policy '${policyId}'`),
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
