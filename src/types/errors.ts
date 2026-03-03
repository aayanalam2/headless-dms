import { Result } from "@carbonteq/fp";

// ---------------------------------------------------------------------------
// Typed error union — every failure in the system is one of these tags.
//
// Discriminating on `tag` in controllers maps cleanly to HTTP status codes
// without any `instanceof` checks or hidden control flow via exceptions.
// ---------------------------------------------------------------------------

export type AppError =
  | { readonly tag: "NotFound"; readonly resource: string }
  | { readonly tag: "AccessDenied"; readonly reason: string }
  | { readonly tag: "Conflict"; readonly message: string }
  | { readonly tag: "ValidationError"; readonly message: string }
  | { readonly tag: "StorageError"; readonly cause: unknown }
  | { readonly tag: "DatabaseError"; readonly cause: unknown };

// ---------------------------------------------------------------------------
// Convenience constructors — prefer these over object literals so callers
// don't have to remember the exact shape.
// ---------------------------------------------------------------------------

export const AppError = {
  notFound: (resource: string): AppError => ({ tag: "NotFound", resource }),
  accessDenied: (reason: string): AppError => ({ tag: "AccessDenied", reason }),
  conflict: (message: string): AppError => ({ tag: "Conflict", message }),
  validation: (message: string): AppError => ({
    tag: "ValidationError",
    message,
  }),
  storage: (cause: unknown): AppError => ({ tag: "StorageError", cause }),
  database: (cause: unknown): AppError => ({ tag: "DatabaseError", cause }),
} as const;

// ---------------------------------------------------------------------------
// AppResult<T> — the standard return type for any fallible operation.
// Controllers receive this and decide how to map it to an HTTP response.
// ---------------------------------------------------------------------------

export type AppResult<T> = Result<T, AppError>;

// Re-export Result for convenience so callers only need one import
export { Result };
