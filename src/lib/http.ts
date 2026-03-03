import { type AppError, ErrorTag } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// mapErrorToResponse
//
// Pure function that converts a typed AppError into an HTTP status code and
// a JSON-serialisable error body. Used identically in every controller so
// error handling is consistent across the entire API.
// ---------------------------------------------------------------------------

export type HttpErrorResponse = {
  readonly status: number;
  readonly body: { readonly error: string; readonly detail?: string };
};

// assertNever — compile-time exhaustiveness guard.
// If a new ErrorTag variant is added but not handled here TypeScript will
// flag it as an error before a single test is run.
export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${String(x)}`);
}

export function mapErrorToResponse(err: AppError): HttpErrorResponse {
  switch (err.tag) {
    case ErrorTag.NotFound:
      return {
        status: 404,
        body: { error: "Not Found", detail: err.resource },
      };

    case ErrorTag.AccessDenied:
      return {
        status: 403,
        body: { error: "Forbidden", detail: err.reason },
      };

    case ErrorTag.Conflict:
      return {
        status: 409,
        body: { error: "Conflict", detail: err.message },
      };

    case ErrorTag.ValidationError:
      return {
        status: 422,
        body: { error: "Unprocessable Entity", detail: err.message },
      };

    case ErrorTag.StorageError:
      return {
        status: 502,
        body: {
          error: "Storage Error",
          detail:
            err.cause instanceof Error ? err.cause.message : "Unknown storage error",
        },
      };

    case ErrorTag.DatabaseError:
      return {
        status: 500,
        body: {
          error: "Internal Server Error",
          detail:
            err.cause instanceof Error
              ? err.cause.message
              : "Database operation failed",
        },
      };

    default:
      return assertNever(err);
  }
}
