import bcrypt from "bcryptjs";
import { Effect } from "effect";
import type { UserRow } from "../models/db/schema.ts";
import type { HashedPassword } from "../types/branded.ts";
import { Role } from "../types/enums.ts";
import { AppError } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// Auth service — pure functions (no I/O other than CPU-bound hashing).
//
// hashPassword / verifyPassword wrap bcryptjs. They are intentionally the
// only place in the codebase that touches plaintext passwords.
// ---------------------------------------------------------------------------

export type JwtClaims = {
  readonly userId: string;
  readonly email: string;
  readonly role: Role;
};

// ---------------------------------------------------------------------------
// requireRole
// Returns Effect.succeed(void) when the actor holds one of the allowed roles,
// or Effect.fail(AppError.accessDenied) otherwise.
// Composes directly into any effect pipeline — no controller boilerplate.
// ---------------------------------------------------------------------------

export function requireRole(actor: JwtClaims, ...allowed: Role[]): Effect.Effect<void, AppError> {
  return allowed.includes(actor.role)
    ? Effect.void
    : Effect.fail(AppError.accessDenied(`requires role: ${allowed.join(" | ")}`));
}

// ---------------------------------------------------------------------------
// hashPassword
// Produces a bcrypt hash from a plaintext password.
// The result is typed as HashedPassword to prevent it being used as plain text.
// ---------------------------------------------------------------------------

export async function hashPassword(plaintext: string, rounds: number): Promise<HashedPassword> {
  const hash = await bcrypt.hash(plaintext, rounds);
  return hash as HashedPassword;
}

// ---------------------------------------------------------------------------
// verifyPassword
// Pure predicate — returns true when plaintext matches the stored hash.
// ---------------------------------------------------------------------------

export async function verifyPassword(plaintext: string, hashed: HashedPassword): Promise<boolean> {
  return bcrypt.compare(plaintext, hashed as string);
}

// ---------------------------------------------------------------------------
// buildJwtClaims
// Pure transformation: UserRow → JwtClaims.
// Only the fields that belong in a JWT are extracted here.
// ---------------------------------------------------------------------------

export function buildJwtClaims(user: UserRow): JwtClaims {
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
}
