import { Effect as E, pipe } from "effect";
import type { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type { AccessPolicyId } from "@domain/utils/refined.types.ts";
import { liftRepo } from "./access-policy.helpers.ts";
import type { AccessPolicyWorkflowError as WorkflowError } from "./access-policy-workflow.errors.ts";

/**
 * Atomically replace a policy: delete the old one, then save the replacement.
 * AccessPolicy is immutable — an update is always a delete-then-insert with a new ID.
 */
export function replacePolicy(
  repo: IAccessPolicyRepository,
  oldId: AccessPolicyId,
  replacement: AccessPolicy,
): E.Effect<void, WorkflowError> {
  return pipe(
    liftRepo(repo.delete(oldId)),
    E.flatMap(() => liftRepo(repo.save(replacement))),
  );
}
