// ---------------------------------------------------------------------------
// Access Policy Workflow Error vocabulary
//
// This is the application layer's stable error contract for all access-policy
// workflows.  Lower-level errors (RepositoryError, domain errors) must NEVER
// escape past a workflow method — they are mapped here so that callers
// (controllers) only reason about this vocabulary.
//
// Mapping rule:
//   • Domain business-rule failures  → NotFound / AccessDenied / Conflict / InvalidInput
//   • Infra failures (repo)          → Unavailable
//   • Input decode/validation        → InvalidInput
// ---------------------------------------------------------------------------

export const AccessPolicyWorkflowErrorTag = {
  InvalidInput: "AccessPolicyWorkflow.InvalidInput",
  NotFound: "AccessPolicyWorkflow.NotFound",
  AccessDenied: "AccessPolicyWorkflow.AccessDenied",
  Conflict: "AccessPolicyWorkflow.Conflict",
  Unavailable: "AccessPolicyWorkflow.Unavailable",
} as const;

export type AccessPolicyWorkflowErrorTag =
  (typeof AccessPolicyWorkflowErrorTag)[keyof typeof AccessPolicyWorkflowErrorTag];

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type AccessPolicyWorkflowError =
  | {
      readonly _tag: typeof AccessPolicyWorkflowErrorTag.InvalidInput;
      readonly message: string;
    }
  | {
      readonly _tag: typeof AccessPolicyWorkflowErrorTag.NotFound;
      readonly resource: string;
    }
  | {
      readonly _tag: typeof AccessPolicyWorkflowErrorTag.AccessDenied;
      readonly reason: string;
    }
  | {
      readonly _tag: typeof AccessPolicyWorkflowErrorTag.Conflict;
      readonly message: string;
    }
  | {
      readonly _tag: typeof AccessPolicyWorkflowErrorTag.Unavailable;
      readonly cause?: unknown;
    };

// ---------------------------------------------------------------------------
// Smart constructors
// ---------------------------------------------------------------------------

export const AccessPolicyWorkflowError = {
  invalidInput: (message: string): AccessPolicyWorkflowError => ({
    _tag: AccessPolicyWorkflowErrorTag.InvalidInput,
    message,
  }),

  notFound: (resource: string): AccessPolicyWorkflowError => ({
    _tag: AccessPolicyWorkflowErrorTag.NotFound,
    resource,
  }),

  accessDenied: (reason: string): AccessPolicyWorkflowError => ({
    _tag: AccessPolicyWorkflowErrorTag.AccessDenied,
    reason,
  }),

  conflict: (message: string): AccessPolicyWorkflowError => ({
    _tag: AccessPolicyWorkflowErrorTag.Conflict,
    message,
  }),

  unavailable: (cause?: unknown): AccessPolicyWorkflowError => ({
    _tag: AccessPolicyWorkflowErrorTag.Unavailable,
    cause,
  }),
} as const;
