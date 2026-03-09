import bcrypt from "bcryptjs";
import { Schema as S } from "effect";
import { injectable } from "tsyringe";
import type { HashedPassword } from "@domain/utils/refined.types.ts";
import { StringToHashedPassword } from "@domain/utils/refined.types.ts";
import { config } from "@infra/config/env.ts";

// ---------------------------------------------------------------------------
// Password utilities — only place in the codebase that touches plaintext
// passwords. Pure functions (no I/O other than CPU-bound hashing).
// ---------------------------------------------------------------------------

/**
 * Produces a bcrypt hash from a plaintext password.
 * The result is typed as HashedPassword to prevent accidental plaintext usage.
 */
export async function hashPassword(plaintext: string, rounds: number): Promise<HashedPassword> {
  const hash = await bcrypt.hash(plaintext, rounds);
  return S.decodeSync(StringToHashedPassword)(hash);
}

/**
 * Returns true when plaintext matches the stored hash.
 */
export async function verifyPassword(plaintext: string, hashed: HashedPassword): Promise<boolean> {
  return bcrypt.compare(plaintext, String(hashed));
}

// ---------------------------------------------------------------------------
// Injectable AuthService — wraps the standalone functions, closing over
// `config.bcryptRounds` so callers do not need to pass it manually.
// ---------------------------------------------------------------------------

@injectable()
export class AuthService {
  private readonly rounds = config.bcryptRounds;

  hash(plaintext: string): Promise<HashedPassword> {
    return hashPassword(plaintext, this.rounds);
  }

  verify(plaintext: string, hashed: HashedPassword): Promise<boolean> {
    return verifyPassword(plaintext, hashed);
  }
}
