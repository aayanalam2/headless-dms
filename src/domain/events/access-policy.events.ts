// ---------------------------------------------------------------------------
// Domain events emitted by access-policy workflows.
// Consumers (e.g. audit listener) subscribe without being coupled to the
// emitting workflow.
// ---------------------------------------------------------------------------

import type { UserId, DocumentId, AccessPolicyId } from "@domain/utils/refined.types.ts";
import type {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";

export enum AccessPolicyEvent {
  Granted = "access-policy.granted",
  Updated = "access-policy.updated",
  Revoked = "access-policy.revoked",
}

export type AccessPolicyGrantedEvent = {
  readonly actorId: UserId;
  /** The new policy's ID. */
  readonly resourceId: AccessPolicyId;
  readonly documentId: DocumentId;
  readonly action: PermissionAction;
  readonly effect: PolicyEffect;
};

export type AccessPolicyUpdatedEvent = {
  readonly actorId: UserId;
  /** The replacement policy's ID. */
  readonly resourceId: AccessPolicyId;
  readonly documentId: DocumentId;
  readonly previousPolicyId: AccessPolicyId;
  readonly effect: PolicyEffect;
};

export type AccessPolicyRevokedEvent = {
  readonly actorId: UserId;
  /** The revoked policy's ID. */
  readonly resourceId: AccessPolicyId;
  readonly documentId: DocumentId;
  readonly action: PermissionAction;
};

export type AccessPolicyEventMap = {
  [AccessPolicyEvent.Granted]: AccessPolicyGrantedEvent;
  [AccessPolicyEvent.Updated]: AccessPolicyUpdatedEvent;
  [AccessPolicyEvent.Revoked]: AccessPolicyRevokedEvent;
};
