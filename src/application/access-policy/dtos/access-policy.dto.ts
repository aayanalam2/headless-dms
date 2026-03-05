import { Option, Schema as S } from "effect";
import type { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";

// ---------------------------------------------------------------------------
// AccessPolicyDTO
//
// Serialized view of an AccessPolicy entity exposed by the application layer.
// Type is derived from the schema — never write it manually.
// ---------------------------------------------------------------------------

export const AccessPolicyDTOSchema = S.Struct({
  id: S.String,
  documentId: S.String,
  /** `null` when the policy is role-based. */
  subjectId: S.NullOr(S.String),
  /** `null` when the policy is user-specific. */
  subjectRole: S.NullOr(S.String),
  action: S.String,
  effect: S.String,
  createdAt: S.String,
});
export type AccessPolicyDTO = S.Schema.Type<typeof AccessPolicyDTOSchema>;

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function toAccessPolicyDTO(policy: AccessPolicy): AccessPolicyDTO {
  return {
    id: policy.id,
    documentId: policy.documentId,
    subjectId: Option.getOrNull(policy.subjectId),
    subjectRole: Option.getOrNull(policy.subjectRole),
    action: policy.action,
    effect: policy.effect,
    createdAt: policy.createdAt.toISOString(),
  };
}
