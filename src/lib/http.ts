import { Effect, Either } from "effect";
import { StatusCode } from "status-code-enum";
import { type AppError, ErrorTag } from "../types/errors.ts";
import { logger } from "./logger.ts";

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
        status: StatusCode.ClientErrorNotFound,
        body: { error: "Not Found", detail: err.resource },
      };

    case ErrorTag.AccessDenied:
      return {
        status: StatusCode.ClientErrorForbidden,
        body: { error: "Forbidden", detail: err.reason },
      };

    case ErrorTag.Conflict:
      return {
        status: StatusCode.ClientErrorConflict,
        body: { error: "Conflict", detail: err.message },
      };

    case ErrorTag.ValidationError:
      return {
        status: StatusCode.ClientErrorUnprocessableEntity,
        body: { error: "Unprocessable Entity", detail: err.message },
      };

    case ErrorTag.StorageError:
      return {
        status: StatusCode.ServerErrorBadGateway,
        body: { error: "Storage Error" },
      };

    case ErrorTag.DatabaseError:
      return {
        status: StatusCode.ServerErrorInternal,
        body: { error: "Internal Server Error" },
      };

    default:
      return assertNever(err);
  }
}

// ---------------------------------------------------------------------------
// run — shared Effect executor used by all controllers.
// Runs the effect, maps any AppError to the appropriate HTTP status + body,
// and returns the success value directly when the effect succeeds.
// ---------------------------------------------------------------------------
export async function run<T>(
  set: { status?: number | string | undefined },
  effect: Effect.Effect<T, AppError>,
): Promise<T | ReturnType<typeof mapErrorToResponse>["body"]> {
  const either = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(either)) {
    const err = either.left;
    const mapped = mapErrorToResponse(err);
    // Log 5xx errors server-side so the cause is visible in logs but never
    // sent to the client.
    if (mapped.status >= 500) {
      logger.error(
        {
          tag: err.tag,
          cause:
            (err as { cause?: unknown }).cause instanceof Error
              ? (err as { cause?: unknown }).cause
              : String((err as { cause?: unknown }).cause),
        },
        "Internal error",
      );
    }
    set.status = mapped.status;
    return mapped.body;
  }
  return either.right;
}
