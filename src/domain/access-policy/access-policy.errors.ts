import { DomainError } from "@domain/utils/base.errors.ts";
import type { AccessPolicyId } from "@domain/utils/refined.types.ts";

export enum AccessPolicyErrorTags {
  AccessPolicyNotFound = "AccessPolicyNotFound",
}

/** No access policy row matched the requested ID. */
export class AccessPolicyNotFoundError extends DomainError {
  readonly _tag = AccessPolicyErrorTags.AccessPolicyNotFound as const;

  constructor(readonly policyId: AccessPolicyId) {
    super(`Access policy '${policyId}' was not found`);
  }
}

/** Union of every error that can originate within the access-policy sub-domain. */
export type AccessPolicyDomainError = AccessPolicyNotFoundError;
