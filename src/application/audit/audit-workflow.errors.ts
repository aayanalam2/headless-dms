// ---------------------------------------------------------------------------
// Audit Workflow Error vocabulary
//
// Stable application-layer contract for all audit log workflows.
//
// Mapping rule:
//   • Schema parse failures  → InvalidInput
//   • RepositoryError        → Unavailable
// ---------------------------------------------------------------------------

export const AuditWorkflowErrorTag = {
  InvalidInput: "AuditWorkflow.InvalidInput",
  Forbidden: "AuditWorkflow.Forbidden",
  Unavailable: "AuditWorkflow.Unavailable",
} as const;

export type AuditWorkflowErrorTag =
  (typeof AuditWorkflowErrorTag)[keyof typeof AuditWorkflowErrorTag];

export type AuditWorkflowError =
  | { readonly _tag: typeof AuditWorkflowErrorTag.InvalidInput; readonly message: string }
  | { readonly _tag: typeof AuditWorkflowErrorTag.Forbidden; readonly reason: string }
  | {
      readonly _tag: typeof AuditWorkflowErrorTag.Unavailable;
      readonly operation: string;
      readonly cause?: unknown;
    };

export const AuditWorkflowError = {
  invalidInput: (message: string): AuditWorkflowError => ({
    _tag: AuditWorkflowErrorTag.InvalidInput,
    message,
  }),

  forbidden: (reason: string): AuditWorkflowError => ({
    _tag: AuditWorkflowErrorTag.Forbidden,
    reason,
  }),

  unavailable: (operation: string, cause?: unknown): AuditWorkflowError => ({
    _tag: AuditWorkflowErrorTag.Unavailable,
    operation,
    cause,
  }),
} as const;
