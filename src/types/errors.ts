// ---------------------------------------------------------------------------
// Typed error union — every failure in the system is one of these tags.
//
// Discriminating on `tag` in controllers maps cleanly to HTTP status codes
// without any `instanceof` checks or hidden control flow via exceptions.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ErrorTag — closed enum of all error kinds the system can produce.
// Using an enum here (rather than a plain string union) means any future
// exhaustiveness check via assertNever will be caught by the compiler.
// ---------------------------------------------------------------------------

export enum ErrorTag {
  NotFound = "NotFound",
  AccessDenied = "AccessDenied",
  Conflict = "Conflict",
  ValidationError = "ValidationError",
  StorageError = "StorageError",
  DatabaseError = "DatabaseError",
}

export type AppError =
  | { readonly tag: ErrorTag.NotFound; readonly resource: string }
  | { readonly tag: ErrorTag.AccessDenied; readonly reason: string }
  | { readonly tag: ErrorTag.Conflict; readonly message: string }
  | { readonly tag: ErrorTag.ValidationError; readonly message: string }
  | { readonly tag: ErrorTag.StorageError; readonly cause: unknown }
  | { readonly tag: ErrorTag.DatabaseError; readonly cause: unknown };

// ---------------------------------------------------------------------------
// Convenience constructors — prefer these over object literals so callers
// don't have to remember the exact shape.
// ---------------------------------------------------------------------------

export const AppError = {
  notFound: (resource: string): AppError => ({ tag: ErrorTag.NotFound, resource }),
  accessDenied: (reason: string): AppError => ({ tag: ErrorTag.AccessDenied, reason }),
  conflict: (message: string): AppError => ({ tag: ErrorTag.Conflict, message }),
  validation: (message: string): AppError => ({
    tag: ErrorTag.ValidationError,
    message,
  }),
  storage: (cause: unknown): AppError => ({ tag: ErrorTag.StorageError, cause }),
  database: (cause: unknown): AppError => ({ tag: ErrorTag.DatabaseError, cause }),
} as const;
