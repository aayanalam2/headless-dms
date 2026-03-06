import { Effect as E, Either } from "effect";
import { StatusCode } from "status-code-enum";
import { type AppError, ErrorTag } from "@infra/errors.ts";
import { logger } from "./logger.ts";

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

export async function run<T>(
  set: { status?: number | string | undefined },
  effect: E.Effect<T, AppError>,
): Promise<T | ReturnType<typeof mapErrorToResponse>["body"]> {
  const either = await E.runPromise(E.either(effect));
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
