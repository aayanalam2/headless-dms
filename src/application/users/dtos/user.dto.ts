import { Schema as S } from "effect";
import { UserSchema } from "@domain/user/user.entity.ts";
import type { User } from "@domain/user/user.entity.ts";
import { Role } from "@domain/utils/enums.ts";
import { ActorCommandSchema } from "@application/shared/actor.ts";

// ===========================================================================
// INBOUND — Command / Query schemas
// ===========================================================================

export const RegisterUserCommandSchema = S.Struct({
  email: S.String,
  password: S.String,
  role: S.optional(S.Enums(Role)),
});
export type RegisterUserCommandEncoded = S.Schema.Encoded<typeof RegisterUserCommandSchema>;
export type RegisterUserCommand = S.Schema.Type<typeof RegisterUserCommandSchema>;

export const LoginCommandSchema = S.Struct({
  email: S.String,
  password: S.String,
});
export type LoginCommandEncoded = S.Schema.Encoded<typeof LoginCommandSchema>;
export type LoginCommand = S.Schema.Type<typeof LoginCommandSchema>;

export const ChangeUserRoleCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  targetUserId: UserSchema.fields.id,
  newRole: S.Enums(Role),
});
export type ChangeUserRoleCommandEncoded = S.Schema.Encoded<typeof ChangeUserRoleCommandSchema>;
export type ChangeUserRoleCommand = S.Schema.Type<typeof ChangeUserRoleCommandSchema>;

// ===========================================================================
// OUTBOUND — Response DTO schemas + mappers
// ===========================================================================

// `passwordHash` must never leave the server; `updatedAt` is internal.
export const UserDTOSchema = UserSchema.omit("passwordHash", "updatedAt");
export type UserDTO = S.Schema.Encoded<typeof UserDTOSchema>;

// ---------------------------------------------------------------------------
// JwtClaims — the minimal payload embedded in a JWT.
//
// The workflow produces this; the controller (or middleware) signs the token.
// Keeping claims separate from the full UserDTO lets each consumer take only
// what it needs.
// ---------------------------------------------------------------------------

export type JwtClaims = {
  readonly userId: string;
  readonly email: string;
  readonly role: Role;
};

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id as string,
    email: user.email as string,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toJwtClaims(user: User): JwtClaims {
  return {
    userId: user.id as string,
    email: user.email as string,
    role: user.role,
  };
}
