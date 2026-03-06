import { Elysia, t } from "elysia";
import { Effect, Either, pipe } from "effect";
import { jwtPlugin } from "../middleware/auth.plugin.ts";
import { StatusCode } from "status-code-enum";
import { Role } from "@domain/utils/enums.ts";
import { run, assertNever } from "../lib/http.ts";
import { AppError } from "@infra/errors.ts";
import type { UserWorkflows } from "@application/users/user.workflows.ts";
import {
  UserWorkflowErrorTag,
  type UserWorkflowError,
} from "@application/users/user-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Error bridge — maps UserWorkflowError to the controller-layer AppError.
// ---------------------------------------------------------------------------

function toAppError(e: UserWorkflowError): AppError {
  switch (e._tag) {
    case UserWorkflowErrorTag.InvalidInput:
      return AppError.validation(e.message);
    case UserWorkflowErrorTag.NotFound:
      return AppError.notFound(e.resource);
    case UserWorkflowErrorTag.Duplicate:
      return AppError.conflict(e.message);
    case UserWorkflowErrorTag.Unauthorized:
      return AppError.accessDenied("Invalid credentials");
    case UserWorkflowErrorTag.Forbidden:
      return AppError.accessDenied(e.reason);
    case UserWorkflowErrorTag.Unavailable:
      return AppError.database(e.operation);
    default:
      return assertNever(e);
  }
}

// ---------------------------------------------------------------------------
// createAuthController
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAuthController(workflows: UserWorkflows) {
  return (
    new Elysia({ prefix: "/auth" })
      .use(jwtPlugin)

      // -----------------------------------------------------------------------
      // POST /auth/register
      // -----------------------------------------------------------------------
      .post(
        "/register",
        ({ body, jwt, set }) =>
          run(
            set,
            pipe(
              workflows.register(body),
              Effect.mapError(toAppError),
              Effect.flatMap((user) =>
                pipe(
                  Effect.promise(() =>
                    jwt.sign({ userId: user.id, email: user.email, role: user.role }),
                  ),
                  Effect.map((token) => ({ token, user })),
                ),
              ),
            ),
          ),
        {
          body: t.Object({
            email: t.String({ format: "email" }),
            password: t.String({ minLength: 8 }),
            role: t.Optional(t.Union([t.Literal(Role.Admin), t.Literal(Role.User)])),
          }),
          detail: { summary: "Register a new user", tags: ["Auth"] },
        },
      )

      // -----------------------------------------------------------------------
      // POST /auth/login
      //
      // Security: always respond with 401 on any failure — avoids user
      // enumeration regardless of whether the email exists, the password is
      // wrong, or a database error occurred.
      // -----------------------------------------------------------------------
      .post(
        "/login",
        async ({ body, jwt, set }) => {
          const either = await Effect.runPromise(Effect.either(workflows.login(body)));

          if (Either.isLeft(either)) {
            set.status = StatusCode.ClientErrorUnauthorized;
            return { error: "Invalid email or password" };
          }

          const { claims, user } = either.right;
          const token = await jwt.sign(claims);
          return { token, user };
        },
        {
          body: t.Object({
            email: t.String(),
            password: t.String(),
          }),
          detail: { summary: "Login with email and password", tags: ["Auth"] },
        },
      )
  );
}
