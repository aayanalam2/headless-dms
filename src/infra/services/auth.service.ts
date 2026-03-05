import bcrypt from "bcryptjs";
import { injectable } from "tsyringe";
import type { HashedPassword } from "@domain/utils/refined.types.ts";
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
  return hash as HashedPassword;
}

/**
 * Returns true when plaintext matches the stored hash.
 */
export async function verifyPassword(plaintext: string, hashed: HashedPassword): Promise<boolean> {
  return bcrypt.compare(plaintext, hashed as string);
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

  verify(plaintext: string, hashed: string): Promise<boolean> {
    return verifyPassword(plaintext, hashed as HashedPassword);
  }
}
