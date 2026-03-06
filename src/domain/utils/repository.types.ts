import type { Effect as E } from "effect";
import { DomainError } from "@domain/utils/base.errors.ts";

export class RepositoryError extends DomainError {
  readonly _tag = "RepositoryError" as const;

  constructor(
    /** Human-readable context (the operation that failed). */
    readonly operation: string,
    /** The underlying cause, if available. */
    override readonly cause?: unknown,
  ) {
    super(`Repository operation failed: ${operation}`);
  }
}

export type RepositoryEffect<A, Err = never> = E.Effect<A, Err | RepositoryError>;
