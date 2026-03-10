import { Effect as E, pipe } from "effect";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyType } from "@domain/access-policy/access-policy.entity.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import type {
  AccessPolicyId,
} from "@domain/utils/refined.types.ts";
import { newAccessPolicyId } from "@domain/utils/refined.types.ts";
import type { DocumentActorCtx, Actor } from "@application/shared/actor.ts";
import type { DocumentAccessGuard } from "@application/security/document-access.guard.ts";
import { PermissionAction, type PolicyEffect } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import {
  AccessPolicyWorkflowError,
  type AccessPolicyWorkflowError as WorkflowError,
} from "../access-policy-workflow.errors.ts";
import { liftRepo, requirePolicy, buildPolicy } from "../services/access-policy.repository.ts";
import type {
  GrantAccessCommand,
  UpdateAccessCommand,
  RevokeAccessCommand,
} from "../dtos/access-policy.dto.ts";

// ---------------------------------------------------------------------------
// Named pipeline context types
// ---------------------------------------------------------------------------

/** Decoded grant command — reuses the DTO type directly. */
export type GrantPolicyCtx = GrantAccessCommand;

/** Grant context after the new policy entity has been constructed. */
export type GrantPolicyCtxWithPolicy<T> = T & { readonly policy: AccessPolicy };

/** Update/revoke context after the existing policy has been loaded. */
export type PolicyCtxWithExisting<T> = T & { readonly existing: AccessPolicyType };

/** Update context after the replacement policy has been constructed. */
export type PolicyCtxWithReplacement<T> = PolicyCtxWithExisting<T> & {
  readonly replacement: AccessPolicy;
};

// ---------------------------------------------------------------------------
// Guard validation steps
// ---------------------------------------------------------------------------

/**
 * Verifies Share access using `ctx.documentId`.
 * Used by grantAccess, checkAccess, and listDocumentPolicies.
 */
export function validateShareAccess<T extends DocumentActorCtx>(
  guard: DocumentAccessGuard,
): (ctx: T) => E.Effect<T, WorkflowError> {
  return (ctx) =>
    E.as(
      guard.require(ctx.documentId, ctx.actor, PermissionAction.Share, AccessPolicyWorkflowError),
      ctx,
    );
}

/**
 * Verifies Share access using `ctx.existing.documentId`.
 * Used by updateAccess and revokeAccess after the existing policy is loaded.
 */
export function validateExistingPolicyAccess<
  T extends { existing: Pick<AccessPolicyType, "documentId">; actor: Actor },
>(
  guard: DocumentAccessGuard,
): (ctx: T) => E.Effect<T, WorkflowError> {
  return (ctx) =>
    E.as(
      guard.require(
        ctx.existing.documentId,
        ctx.actor,
        PermissionAction.Share,
        AccessPolicyWorkflowError,
      ),
      ctx,
    );
}

// ---------------------------------------------------------------------------
// Policy construction steps
// ---------------------------------------------------------------------------

/** Builds a new AccessPolicy entity and merges it as `policy` into the context. */
export function buildGrantPolicy<T extends GrantAccessCommand>(
  ctx: T,
): E.Effect<T & { policy: AccessPolicy }, WorkflowError> {
  return E.map(
    buildPolicy({
      id: newAccessPolicyId(),
      createdAt: new Date(),
      documentId: ctx.documentId,
      subjectId: ctx.subjectId,
      action: ctx.action,
      effect: ctx.effect,
    }),
    (policy) => ({ ...ctx, policy }),
  );
}

/** Loads the existing policy by policyId and merges it as `existing` into the context. */
export function requireExistingPolicy<T extends { policyId: AccessPolicyId }>(
  repo: IAccessPolicyRepository,
): (ctx: T) => E.Effect<T & { existing: AccessPolicyType }, WorkflowError> {
  return (ctx) =>
    E.map(requirePolicy(repo, ctx.policyId), (existing) => ({ ...ctx, existing }));
}

/** Builds the replacement policy from `ctx.existing` + `ctx.effect` and merges it as `replacement`. */
export function buildPolicyReplacement<
  T extends { existing: AccessPolicyType; effect: PolicyEffect },
>(ctx: T): E.Effect<T & { replacement: AccessPolicy }, WorkflowError> {
  return E.map(
    buildPolicy({
      id: newAccessPolicyId(),
      createdAt: new Date(),
      documentId: ctx.existing.documentId,
      subjectId: ctx.existing.subjectId,
      action: ctx.existing.action,
      effect: ctx.effect,
    }),
    (replacement) => ({ ...ctx, replacement }),
  );
}

// ---------------------------------------------------------------------------
// Persistence steps (all used as E.tap)
// ---------------------------------------------------------------------------

/** Saves a new policy to the repository. */
export function savePolicy<T extends { policy: AccessPolicy }>(
  repo: IAccessPolicyRepository,
): (ctx: T) => E.Effect<void, WorkflowError> {
  return (ctx) => liftRepo(repo.save(ctx.policy));
}

/** Deletes, then saves the replacement policy atomically. */
export function replacePolicy<T extends { policyId: AccessPolicyId; replacement: AccessPolicy }>(
  repo: IAccessPolicyRepository,
): (ctx: T) => E.Effect<void, WorkflowError> {
  return (ctx) =>
    pipe(
      liftRepo(repo.delete(ctx.policyId)),
      E.flatMap(() => liftRepo(repo.save(ctx.replacement))),
    );
}

/** Deletes the policy identified by `ctx.policyId`. */
export function deleteExistingPolicy<T extends { policyId: AccessPolicyId }>(
  repo: IAccessPolicyRepository,
): (ctx: T) => E.Effect<void, WorkflowError> {
  return (ctx) => liftRepo(repo.delete(ctx.policyId));
}
