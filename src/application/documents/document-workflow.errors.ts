// ---------------------------------------------------------------------------
// Document Workflow Error vocabulary
//
// This is the application layer's stable error contract for all document
// workflows.  Lower-level errors (RepositoryError, domain errors, storage
// errors) must NEVER escape past a workflow function — they are mapped here
// so that callers (controllers) only reason about this vocabulary.
//
// ---------------------------------------------------------------------------

export const DocumentWorkflowErrorTag = {
  InvalidInput: "DocumentWorkflow.InvalidInput",
  NotFound: "DocumentWorkflow.NotFound",
  AccessDenied: "DocumentWorkflow.AccessDenied",
  Conflict: "DocumentWorkflow.Conflict",
  InvalidContentType: "DocumentWorkflow.InvalidContentType",
  Unavailable: "DocumentWorkflow.Unavailable",
} as const;

export type DocumentWorkflowErrorTag =
  (typeof DocumentWorkflowErrorTag)[keyof typeof DocumentWorkflowErrorTag];

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export type DocumentWorkflowError =
  | {
      readonly _tag: typeof DocumentWorkflowErrorTag.InvalidInput;
      readonly message: string;
    }
  | {
      readonly _tag: typeof DocumentWorkflowErrorTag.NotFound;
      readonly resource: string;
    }
  | {
      readonly _tag: typeof DocumentWorkflowErrorTag.AccessDenied;
      readonly reason: string;
    }
  | {
      readonly _tag: typeof DocumentWorkflowErrorTag.Conflict;
      readonly message: string;
    }
  | {
      readonly _tag: typeof DocumentWorkflowErrorTag.InvalidContentType;
      readonly contentType: string;
    }
  | {
      readonly _tag: typeof DocumentWorkflowErrorTag.Unavailable;
      readonly cause?: unknown;
    };

// ---------------------------------------------------------------------------
// Smart constructors
// ---------------------------------------------------------------------------

export const DocumentWorkflowError = {
  invalidInput: (message: string): DocumentWorkflowError => ({
    _tag: DocumentWorkflowErrorTag.InvalidInput,
    message,
  }),

  notFound: (resource: string): DocumentWorkflowError => ({
    _tag: DocumentWorkflowErrorTag.NotFound,
    resource,
  }),

  accessDenied: (reason: string): DocumentWorkflowError => ({
    _tag: DocumentWorkflowErrorTag.AccessDenied,
    reason,
  }),

  conflict: (message: string): DocumentWorkflowError => ({
    _tag: DocumentWorkflowErrorTag.Conflict,
    message,
  }),

  invalidContentType: (contentType: string): DocumentWorkflowError => ({
    _tag: DocumentWorkflowErrorTag.InvalidContentType,
    contentType,
  }),

  unavailable: (cause?: unknown): DocumentWorkflowError => ({
    _tag: DocumentWorkflowErrorTag.Unavailable,
    cause,
  }),
} as const;
