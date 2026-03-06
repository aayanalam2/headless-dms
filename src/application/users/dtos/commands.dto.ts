import { Schema as S } from "effect";
import { Role } from "@domain/utils/enums.ts";
import { ActorCommandSchema } from "@application/documents/dtos/commands.dto.ts";

// ---------------------------------------------------------------------------
// RegisterUserCommandSchema
//
// Raw HTTP input for user registration.  Password arrives as plaintext and is
// hashed inside the workflow — never stored or logged as-is.
// ---------------------------------------------------------------------------

export const RegisterUserCommandSchema = S.Struct({
  email: S.String,
  password: S.String,
  role: S.optional(S.Enums(Role)),
});
export type RegisterUserCommandEncoded = S.Schema.Encoded<typeof RegisterUserCommandSchema>;
export type RegisterUserCommand = S.Schema.Type<typeof RegisterUserCommandSchema>;

// ---------------------------------------------------------------------------
// LoginCommandSchema
//
// Raw HTTP input for login.  The workflow validates credentials and returns
// `JwtClaims`; JWT signing itself remains the controller's concern.
// ---------------------------------------------------------------------------

export const LoginCommandSchema = S.Struct({
  email: S.String,
  password: S.String,
});
export type LoginCommandEncoded = S.Schema.Encoded<typeof LoginCommandSchema>;
export type LoginCommand = S.Schema.Type<typeof LoginCommandSchema>;

// ---------------------------------------------------------------------------
// ChangeUserRoleCommandSchema
//
// Changes the role of any user.  Only admins may execute this; the guard
// lives inside the workflow rather than the schema so the error is typed.
// ---------------------------------------------------------------------------

export const ChangeUserRoleCommandSchema = S.Struct({
  actor: ActorCommandSchema,
  targetUserId: S.String,
  newRole: S.Enums(Role),
});
export type ChangeUserRoleCommandEncoded = S.Schema.Encoded<typeof ChangeUserRoleCommandSchema>;
export type ChangeUserRoleCommand = S.Schema.Type<typeof ChangeUserRoleCommandSchema>;
