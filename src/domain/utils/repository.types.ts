import type { Effect } from "effect";
import { DomainError } from "@domain/utils/base.errors.ts";

// ---------------------------------------------------------------------------
// Repository-layer error types and Effect alias
// ---------------------------------------------------------------------------

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

export type RepositoryEffect<A, E = never> = Effect.Effect<A, E | RepositoryError>;
