// ---------------------------------------------------------------------------
// User Workflow Error vocabulary
//
// Stable application-layer contract for all user/auth workflows.
// Domain errors (UserNotFoundError, UserAlreadyExistsError) and infra errors
// (RepositoryError) never escape past a workflow function — they are mapped
// here so controllers only reason about this vocabulary.
//
// Mapping rule:
//   • UserAlreadyExistsError            → Duplicate
//   • UserNotFoundError                 → NotFound
//   • Bad email / schema parse failure  → InvalidInput
//   • Wrong password / missing user     → Unauthorized  (never distinguish)
//   • RepositoryError / thrown errors   → Unavailable
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
