import { UserErrorTags } from "@domain/user/user.errors.ts";
import type { UserAlreadyExistsError, UserNotFoundError } from "@domain/user/user.errors.ts";
import type { RepositoryError } from "@domain/utils/repository.types.ts";

// ---------------------------------------------------------------------------
// User Workflow Error vocabulary
//
// Stable application-layer contract for all user/auth workflows.
// Domain and infra errors never escape past a workflow function — they are
// mapped here so controllers only reason about this vocabulary.
// ---------------------------------------------------------------------------

export const UserWorkflowErrorTag = {
  InvalidInput: "UserWorkflow.InvalidInput",
  NotFound: "UserWorkflow.NotFound",
  Duplicate: "UserWorkflow.Duplicate",
  Unauthorized: "UserWorkflow.Unauthorized",
  Forbidden: "UserWorkflow.Forbidden",
  Unavailable: "UserWorkflow.Unavailable",
} as const;

export type UserWorkflowErrorTag = (typeof UserWorkflowErrorTag)[keyof typeof UserWorkflowErrorTag];

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type UserWorkflowError =
  | {
      readonly _tag: typeof UserWorkflowErrorTag.InvalidInput;
      readonly message: string;
    }
  | {
      readonly _tag: typeof UserWorkflowErrorTag.NotFound;
      readonly resource: string;
    }
  | {
      readonly _tag: typeof UserWorkflowErrorTag.Duplicate;
      readonly message: string;
    }
  | {
      readonly _tag: typeof UserWorkflowErrorTag.Unauthorized;
    }
  | {
      readonly _tag: typeof UserWorkflowErrorTag.Forbidden;
      readonly reason: string;
    }
  | {
      readonly _tag: typeof UserWorkflowErrorTag.Unavailable;
      readonly operation: string;
      readonly cause?: unknown;
    };

// ---------------------------------------------------------------------------
// Smart constructors
// ---------------------------------------------------------------------------

export const UserWorkflowError = {
  invalidInput: (message: string): UserWorkflowError => ({
    _tag: UserWorkflowErrorTag.InvalidInput,
    message,
  }),

  notFound: (resource: string): UserWorkflowError => ({
    _tag: UserWorkflowErrorTag.NotFound,
    resource,
  }),

  duplicate: (message: string): UserWorkflowError => ({
    _tag: UserWorkflowErrorTag.Duplicate,
    message,
  }),

  unauthorized: (): UserWorkflowError => ({
    _tag: UserWorkflowErrorTag.Unauthorized,
  }),

  forbidden: (reason: string): UserWorkflowError => ({
    _tag: UserWorkflowErrorTag.Forbidden,
    reason,
  }),

  unavailable: (operation: string, cause?: unknown): UserWorkflowError => ({
    _tag: UserWorkflowErrorTag.Unavailable,
    operation,
    cause,
  }),
} as const;

// ---------------------------------------------------------------------------
// Domain → Workflow boundary translators
//
// These functions are the typed enforcement of the mapping rules above.
// Call them inside application helpers when wrapping repo/domain calls so
// that domain and infra errors never leak past the application layer.
//
//   UserAlreadyExistsError | RepositoryError  →  Duplicate | Unavailable
//   UserNotFoundError      | RepositoryError  →  NotFound  | Unavailable
// ---------------------------------------------------------------------------

export function fromUserSaveError(
  op: string,
  e: UserAlreadyExistsError | RepositoryError,
): UserWorkflowError {
  return e._tag === UserErrorTags.UserAlreadyExists
    ? UserWorkflowError.duplicate(e.message)
    : UserWorkflowError.unavailable(op, e);
}

export function fromUserUpdateError(
  op: string,
  resource: string,
  e: UserNotFoundError | RepositoryError,
): UserWorkflowError {
  return e._tag === UserErrorTags.UserNotFound
    ? UserWorkflowError.notFound(resource)
    : UserWorkflowError.unavailable(op, e);
}
