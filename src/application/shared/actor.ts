import { Schema as S } from "effect";
import { Role as RoleEnum } from "@domain/utils/enums.ts";
import type { Role } from "@domain/utils/enums.ts";
import type { UserId } from "@domain/utils/refined.types.ts";
import { UserSchema } from "@domain/user/user.entity.ts";

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

// ---------------------------------------------------------------------------
// ActorCommandSchema — raw actor shape flowing in from JWT claims.
//
// Shared by every bounded context that receives an authenticated command.
// The HTTP middleware decodes the JWT and constructs this object; the workflow
// validates it at its boundary.
// ---------------------------------------------------------------------------

export const ActorCommandSchema = S.Struct({
  userId: UserSchema.fields.id,
  role: S.Enums(RoleEnum),
});
export type ActorCommandEncoded = S.Schema.Encoded<typeof ActorCommandSchema>;
export type ActorCommand = S.Schema.Type<typeof ActorCommandSchema>;
