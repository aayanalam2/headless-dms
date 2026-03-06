import { Option as O } from "effect";
import type { IAccessPolicy } from "@domain/access-policy/access-policy.entity";
import { PolicyEffect } from "@domain/access-policy/value-objects/permission-action.vo";
import type { UserId } from "@domain/utils/refined.types.ts";
import type { Role } from "@domain/utils/enums.ts";

/**
 * Returns `true` when the policy targets a specific user and that user
 * matches `userId`.
 */
export function appliesTo(policy: IAccessPolicy, userId: UserId): boolean {
  return O.isSome(policy.subjectId) && policy.subjectId.value === userId;
}

/**
 * Returns `true` when the policy targets a role and that role matches.
 */
export function appliesToRole(policy: IAccessPolicy, role: Role): boolean {
  return O.isSome(policy.subjectRole) && policy.subjectRole.value === role;
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

/**
 * Returns `true` when the policy is user-specific (has a `subjectId`).
 */
export function isSubjectPolicy(policy: IAccessPolicy): boolean {
  return O.isSome(policy.subjectId);
}

/**
 * Returns `true` when the policy is role-based (has a `subjectRole`).
 */
export function isRolePolicy(policy: IAccessPolicy): boolean {
  return O.isSome(policy.subjectRole);
}
