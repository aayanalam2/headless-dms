import { Schema as S } from "effect";
import { Role } from "@domain/utils/enums.ts";
import type { User } from "@domain/user/user.entity.ts";

// ---------------------------------------------------------------------------
// UserDTOSchema — outbound shape for user data.
//
// passwordHash is intentionally absent: it must never leave the server.
// ---------------------------------------------------------------------------

export const UserDTOSchema = S.Struct({
  id: S.String,
  email: S.String,
  role: S.Enums(Role),
  createdAt: S.String,
});
export type UserDTO = S.Schema.Type<typeof UserDTOSchema>;

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

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

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
