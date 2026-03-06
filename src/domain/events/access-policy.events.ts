// ---------------------------------------------------------------------------
// Domain events emitted by access-policy workflows.
// Consumers (e.g. audit listener) subscribe without being coupled to the
// emitting workflow.
// ---------------------------------------------------------------------------

export enum AccessPolicyEvent {
  Granted = "access-policy.granted",
  Updated = "access-policy.updated",
  Revoked = "access-policy.revoked",
}

export type AccessPolicyGrantedEvent = {
  readonly actorId: string;
  /** The new policy's ID. */
  readonly resourceId: string;
  readonly documentId: string;
  readonly action: string;
  readonly effect: string;
};

export type AccessPolicyUpdatedEvent = {
  readonly actorId: string;
  /** The replacement policy's ID. */
  readonly resourceId: string;
  readonly documentId: string;
  readonly previousPolicyId: string;
  readonly effect: string;
};

export type AccessPolicyRevokedEvent = {
  readonly actorId: string;
  /** The revoked policy's ID. */
  readonly resourceId: string;
  readonly documentId: string;
  readonly action: string;
};

export type AccessPolicyEventMap = {
  [AccessPolicyEvent.Granted]: AccessPolicyGrantedEvent;
  [AccessPolicyEvent.Updated]: AccessPolicyUpdatedEvent;
  [AccessPolicyEvent.Revoked]: AccessPolicyRevokedEvent;
};
