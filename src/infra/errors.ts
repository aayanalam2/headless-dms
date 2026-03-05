// ---------------------------------------------------------------------------
// AppError — typed error union shared by the infrastructure and presentation
// layers.
//
// Infra repositories surface these error tags; the HTTP presentation layer
// maps them to HTTP status codes without any instanceof checks.
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
