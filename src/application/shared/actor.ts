import type { UserId } from "@domain/utils/refined.types.ts";
import type { Role } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// Actor — the authenticated principal executing a workflow.
//
// Populated from JWT claims at the HTTP boundary and passed down into the
// application layer. Using `UserId` (branded type) instead of raw `string`
// ensures callers convert / validate at the entry point.
// ---------------------------------------------------------------------------

export type Actor = {
  readonly userId: UserId;
  readonly role: Role;
};
