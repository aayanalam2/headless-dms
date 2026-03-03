import type { AppError } from "../types/errors.ts";

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

export function mapErrorToResponse(err: AppError): HttpErrorResponse {
  switch (err.tag) {
    case "NotFound":
      return {
        status: 404,
        body: { error: "Not Found", detail: err.resource },
      };

    case "AccessDenied":
      return {
        status: 403,
        body: { error: "Forbidden", detail: err.reason },
      };

    case "Conflict":
      return {
        status: 409,
        body: { error: "Conflict", detail: err.message },
      };

    case "ValidationError":
      return {
        status: 422,
        body: { error: "Unprocessable Entity", detail: err.message },
      };

    case "StorageError":
      return {
        status: 502,
        body: {
          error: "Storage Error",
          detail:
            err.cause instanceof Error ? err.cause.message : "Unknown storage error",
        },
      };

    case "DatabaseError":
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
  }
}
