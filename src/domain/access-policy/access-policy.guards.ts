import type { IAccessPolicy } from "@domain/access-policy/access-policy.entity";
import { PolicyEffect } from "@domain/access-policy/value-objects/permission-action.vo";
import type { UserId } from "@domain/utils/refined.types.ts";

/**
 * Returns `true` when the policy targets the given user.
 */
export function appliesTo(policy: IAccessPolicy, userId: UserId): boolean {
  return policy.subjectId === userId;
}

/**
 * Returns `true` when the policy's effect is `Allow`.
 */
export function isAllowPolicy(policy: IAccessPolicy): boolean {
  return policy.effect === PolicyEffect.Allow;
}

/**
 * Returns `true` when the policy's effect is `Deny`.
 */
export function isDenyPolicy(policy: IAccessPolicy): boolean {
  return policy.effect === PolicyEffect.Deny;
}
