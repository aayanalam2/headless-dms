import { Option as O, Schema as S } from "effect";
import { Role } from "@domain/utils/enums.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import {
  AccessPolicySchema,
  type AccessPolicy,
} from "@domain/access-policy/access-policy.entity.ts";
import { DocumentSchema } from "@domain/document/document.entity.ts";
import { UserSchema } from "@domain/user/user.entity.ts";
import { ActorCommandSchema } from "@application/shared/actor.ts";

// ===========================================================================
// INBOUND — Command / Query schemas
// ===========================================================================

export const GrantAccessCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: DocumentSchema.fields.id,
  /** Target user ID (mutually exclusive with subjectRole). */
  subjectId: S.optional(UserSchema.fields.id),
  /** Target role (mutually exclusive with subjectId). */
  subjectRole: S.optional(S.Enums(Role)),
  action: S.Enums(PermissionAction),
  effect: S.Enums(PolicyEffect),
});
export type GrantAccessCommandEncoded = S.Schema.Encoded<typeof GrantAccessCommandSchema>;
export type GrantAccessCommand = S.Schema.Type<typeof GrantAccessCommandSchema>;

export const UpdateAccessCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  policyId: AccessPolicySchema.fields.id,
  effect: S.Enums(PolicyEffect),
});
export type UpdateAccessCommandEncoded = S.Schema.Encoded<typeof UpdateAccessCommandSchema>;
export type UpdateAccessCommand = S.Schema.Type<typeof UpdateAccessCommandSchema>;

export const RevokeAccessCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  policyId: AccessPolicySchema.fields.id,
});
export type RevokeAccessCommandEncoded = S.Schema.Encoded<typeof RevokeAccessCommandSchema>;
export type RevokeAccessCommand = S.Schema.Type<typeof RevokeAccessCommandSchema>;

export const CheckAccessQuerySchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: DocumentSchema.fields.id,
  action: S.Enums(PermissionAction),
});
export type CheckAccessQueryEncoded = S.Schema.Encoded<typeof CheckAccessQuerySchema>;
export type CheckAccessQuery = S.Schema.Type<typeof CheckAccessQuerySchema>;

export const ListDocumentPoliciesQuerySchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: DocumentSchema.fields.id,
});
export type ListDocumentPoliciesQueryEncoded = S.Schema.Encoded<
  typeof ListDocumentPoliciesQuerySchema
>;
export type ListDocumentPoliciesQuery = S.Schema.Type<typeof ListDocumentPoliciesQuerySchema>;

// ===========================================================================
// OUTBOUND — Response DTO schema + mapper
// `Encoded` gives the wire form: plain strings, `string | null` for the
// Option fields, enum member strings for action/effect.
// ===========================================================================

export const AccessPolicyDTOSchema = AccessPolicySchema;
export type AccessPolicyDTO = S.Schema.Encoded<typeof AccessPolicyDTOSchema>;

export function toAccessPolicyDTO(policy: AccessPolicy): AccessPolicyDTO {
  return {
    id: policy.id,
    documentId: policy.documentId,
    subjectId: O.getOrNull(policy.subjectId),
    subjectRole: O.getOrNull(policy.subjectRole),
    action: policy.action,
    effect: policy.effect,
    createdAt: policy.createdAt.toISOString(),
  };
}
