import { Schema as S } from "effect";
import { Role } from "@domain/utils/enums.ts";
import { PermissionAction, PolicyEffect } from "@domain/access-policy/value-objects/permission-action.vo.ts";
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
  documentId: S.String,
  /** Target user ID (mutually exclusive with subjectRole). */
  subjectId: S.optional(S.String),
  /** Target role (mutually exclusive with subjectId). */
  subjectRole: S.optional(S.Enums(Role)),
  action: S.Enums(PermissionAction),
  effect: S.Enums(PolicyEffect),
});
export type GrantAccessCommandEncoded = S.Schema.Encoded<typeof GrantAccessCommandSchema>;
export type GrantAccessCommand = S.Schema.Type<typeof GrantAccessCommandSchema>;

// ---------------------------------------------------------------------------
// UpdateAccessCommandSchema
//
// Changes the `effect` (Allow/Deny) of an existing policy identified by
// `policyId`.  Because AccessPolicy is immutable, the workflow deletes the
// old policy and creates a new one; the returned DTO will have a new `id`.
// ---------------------------------------------------------------------------

export const UpdateAccessCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  policyId: S.String,
  effect: S.Enums(PolicyEffect),
});
export type UpdateAccessCommandEncoded = S.Schema.Encoded<typeof UpdateAccessCommandSchema>;
export type UpdateAccessCommand = S.Schema.Type<typeof UpdateAccessCommandSchema>;

// ---------------------------------------------------------------------------
// RevokeAccessCommandSchema
//
// Permanently deletes an access policy.
// ---------------------------------------------------------------------------

export const RevokeAccessCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  policyId: S.String,
});
export type RevokeAccessCommandEncoded = S.Schema.Encoded<typeof RevokeAccessCommandSchema>;
export type RevokeAccessCommand = S.Schema.Type<typeof RevokeAccessCommandSchema>;

// ---------------------------------------------------------------------------
// CheckAccessQuerySchema
//
// Evaluates whether the requesting actor is permitted to perform `action`
// on the specified document, taking all applicable policies into account.
// ---------------------------------------------------------------------------

export const CheckAccessQuerySchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: S.String,
  action: S.Enums(PermissionAction),
});
export type CheckAccessQueryEncoded = S.Schema.Encoded<typeof CheckAccessQuerySchema>;
export type CheckAccessQuery = S.Schema.Type<typeof CheckAccessQuerySchema>;

// ---------------------------------------------------------------------------
// ListDocumentPoliciesQuerySchema
//
// Returns all access policies for a document.
// ---------------------------------------------------------------------------

export const ListDocumentPoliciesQuerySchema = S.Struct({
  actor: ActorCommandSchema,
  documentId: S.String,
});
export type ListDocumentPoliciesQueryEncoded = S.Schema.Encoded<typeof ListDocumentPoliciesQuerySchema>;
export type ListDocumentPoliciesQuery = S.Schema.Type<typeof ListDocumentPoliciesQuerySchema>;
