import { Effect as E } from "effect";
import { makeEmit } from "@application/shared/event.helpers.ts";
import {
  AccessPolicyEvent,
  type AccessPolicyGrantedEvent,
  type AccessPolicyUpdatedEvent,
  type AccessPolicyRevokedEvent,
} from "@domain/events/access-policy.events.ts";
import type {
  GrantPolicyCtxWithPolicy,
  PolicyCtxWithReplacement,
  PolicyCtxWithExisting,
} from "../workflows/steps/access-policy.context.steps.ts";
import type {
  GrantAccessCommand,
  UpdateAccessCommand,
  RevokeAccessCommand,
} from "../dtos/access-policy.dto.ts";

// ---------------------------------------------------------------------------
// Raw event emitters (plain event payload)
// ---------------------------------------------------------------------------

export const emitPolicyGranted = makeEmit<AccessPolicyGrantedEvent>(AccessPolicyEvent.Granted);

export const emitPolicyUpdated = makeEmit<AccessPolicyUpdatedEvent>(AccessPolicyEvent.Updated);

export const emitPolicyRevoked = makeEmit<AccessPolicyRevokedEvent>(AccessPolicyEvent.Revoked);

// ---------------------------------------------------------------------------
// Context-aware emitters (accept pipeline context objects)
// ---------------------------------------------------------------------------

export const emitGrantPolicyCtx = (
  ctx: Pick<GrantPolicyCtxWithPolicy<GrantAccessCommand>, "actor" | "documentId" | "policy">,
): E.Effect<void, never> =>
  emitPolicyGranted({
    actorId: ctx.actor.userId,
    resourceId: ctx.policy.id,
    documentId: ctx.documentId,
    action: ctx.policy.action,
    effect: ctx.policy.effect,
  });

export const emitUpdatePolicyCtx = (ctx: PolicyCtxWithReplacement<UpdateAccessCommand>): E.Effect<void, never> =>
  emitPolicyUpdated({
    actorId: ctx.actor.userId,
    resourceId: ctx.replacement.id,
    previousPolicyId: ctx.policyId,
    documentId: ctx.existing.documentId,
    effect: ctx.effect,
  });

export const emitRevokePolicyCtx = (ctx: PolicyCtxWithExisting<RevokeAccessCommand>): E.Effect<void, never> =>
  emitPolicyRevoked({
    actorId: ctx.actor.userId,
    resourceId: ctx.policyId,
    documentId: ctx.existing.documentId,
    action: ctx.existing.action,
  });
