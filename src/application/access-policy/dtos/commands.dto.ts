import { Schema as S } from "effect";
import { Role } from "@domain/utils/enums.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { AccessPolicySchema } from "@domain/access-policy/access-policy.entity.ts";
import { DocumentSchema } from "@domain/document/document.entity.ts";
import { UserSchema } from "@domain/user/user.entity.ts";
import { ActorCommandSchema } from "@application/documents/dtos/commands.dto.ts";

// Re-export ActorCommandSchema for convenience
export { ActorCommandSchema };

// ---------------------------------------------------------------------------
// GrantAccessCommandSchema
//
// Creates a new access policy for a document.  Exactly one of `subjectId`
// (user-specific) or `subjectRole` (role-based) must be provided.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// UpdateAccessCommandSchema
// ---------------------------------------------------------------------------

export const UpdateAccessCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  policyId: AccessPolicySchema.fields.id,
  effect: S.Enums(PolicyEffect),
});
export type UpdateAccessCommandEncoded = S.Schema.Encoded<typeof UpdateAccessCommandSchema>;
export type UpdateAccessCommand = S.Schema.Type<typeof UpdateAccessCommandSchema>;

// ---------------------------------------------------------------------------
// RevokeAccessCommandSchema
// ---------------------------------------------------------------------------

export const RevokeAccessCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  policyId: AccessPolicySchema.fields.id,
});
export type RevokeAccessCommandEncoded = S.Schema.Encoded<typeof RevokeAccessCommandSchema>;
export type RevokeAccessCommand = S.Schema.Type<typeof RevokeAccessCommandSchema>;

// ---------------------------------------------------------------------------
// CheckAccessQuerySchema
// ---------------------------------------------------------------------------

export const CheckAccessQuerySchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: DocumentSchema.fields.id,
  action: S.Enums(PermissionAction),
});
export type CheckAccessQueryEncoded = S.Schema.Encoded<typeof CheckAccessQuerySchema>;
export type CheckAccessQuery = S.Schema.Type<typeof CheckAccessQuerySchema>;

// ---------------------------------------------------------------------------
// ListDocumentPoliciesQuerySchema
// ---------------------------------------------------------------------------

export const ListDocumentPoliciesQuerySchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: DocumentSchema.fields.id,
});
export type ListDocumentPoliciesQueryEncoded = S.Schema.Encoded<
  typeof ListDocumentPoliciesQuerySchema
>;
export type ListDocumentPoliciesQuery = S.Schema.Type<typeof ListDocumentPoliciesQuerySchema>;
