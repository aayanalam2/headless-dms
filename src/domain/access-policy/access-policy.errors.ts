import { DomainError } from "@domain/utils/base.errors.ts";
import type { AccessPolicyId } from "@domain/utils/refined.types.ts";

export enum AccessPolicyErrorTags {
  AccessPolicyNotFound = "AccessPolicyNotFound",
  PolicyTargetRequired = "PolicyTargetRequired",
}

/** No access policy row matched the requested ID. */
export class AccessPolicyNotFoundError extends DomainError {
  readonly _tag = AccessPolicyErrorTags.AccessPolicyNotFound as const;

  constructor(readonly policyId: AccessPolicyId) {
    super(`Access policy '${policyId}' was not found`);
  }
}

/**
 * Raised when an AccessPolicy is created without exactly one of
 * `subjectId` or `subjectRole`.  Every policy must target either a
 * specific user or a role — not both, not neither.
 */
export class PolicyTargetRequiredError extends DomainError {
  readonly _tag = AccessPolicyErrorTags.PolicyTargetRequired as const;

  constructor() {
    super(
      "An access policy must target exactly one of: a specific user (subjectId) or a role (subjectRole)",
    );
  }
}

/** Union of every error that can originate within the access-policy sub-domain. */
export type AccessPolicyDomainError = AccessPolicyNotFoundError | PolicyTargetRequiredError;
