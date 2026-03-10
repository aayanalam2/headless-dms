import { Effect as E } from "effect";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyType } from "@domain/access-policy/access-policy.entity.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { AccessPolicyId } from "@domain/utils/refined.types.ts";
import { makeLiftRepo, requireFound } from "@application/shared/workflow.helpers.ts";
import {
  AccessPolicyWorkflowError,
  type AccessPolicyWorkflowError as WorkflowError,
} from "../access-policy-workflow.errors.ts";

/** Lift any effect's error to Unavailable. Intended for repository calls. */
export const liftRepo = makeLiftRepo(AccessPolicyWorkflowError.unavailable);

export function requirePolicy(
  repo: IAccessPolicyRepository,
  policyId: AccessPolicyId,
): E.Effect<AccessPolicyType, WorkflowError> {
  return requireFound(repo.findById(policyId), AccessPolicyWorkflowError.unavailable, () =>
    AccessPolicyWorkflowError.notFound(`Access policy '${policyId}'`),
  );
}

export function buildPolicy(input: AccessPolicyType): E.Effect<AccessPolicy, WorkflowError> {
  return E.succeed(AccessPolicy.createNew(input));
}
