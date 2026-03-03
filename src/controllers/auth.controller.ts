import { Elysia, t } from "elysia";
import { Effect, Either, pipe } from "effect";
import { jwtPlugin } from "../middleware/auth.plugin.ts";
import { findUserByEmail, createUser } from "../models/user.repository.ts";
import { hashPassword, verifyPassword, buildJwtClaims } from "../services/auth.service.ts";
import { StatusCode } from "status-code-enum";
import { Email } from "../types/branded.ts";
import { AppError, ErrorTag } from "../types/errors.ts";
import { Role } from "../types/enums.ts";
import { toUserDTO } from "../dto/user.dto.ts";
import { run } from "../lib/http.ts";
import { config } from "../config/env.ts";

// ---------------------------------------------------------------------------
// Auth controller
// ---------------------------------------------------------------------------

export const authController = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin)

  // -------------------------------------------------------------------------
  // POST /auth/register
  // -------------------------------------------------------------------------
  .post(
    "/register",
    ({ body, jwt, set }) =>
      run(
        set,
        Effect.gen(function* () {
          // Validate email as branded type
          const emailValidation = Email.create(body.email);
          if (!emailValidation.isOk()) {
            yield* Effect.fail(AppError.validation("Invalid email address"));
          }

          // Check for duplicate — NotFound means the email is free
          const existingEither = yield* Effect.either(findUserByEmail(body.email));
          if (Either.isRight(existingEither)) {
            yield* Effect.fail(AppError.conflict("An account with this email already exists"));
          }
          if (Either.isLeft(existingEither) && existingEither.left.tag !== ErrorTag.NotFound) {
            yield* Effect.fail(existingEither.left);
          }

          // Hash password and create user
          const passwordHash = yield* Effect.promise(() =>
            hashPassword(body.password, config.bcryptRounds),
          );
          const user = yield* createUser({
            email: body.email,
            passwordHash: passwordHash as string,
            role: body.role ?? Role.User,
          });

          const token = yield* Effect.promise(() => jwt.sign(buildJwtClaims(user)));
          return { token, user: toUserDTO(user) };
        }),
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

  // -------------------------------------------------------------------------
  // POST /auth/login
  // -------------------------------------------------------------------------
  .post(
    "/login",
    async ({ body, jwt, set }) => {
      // Always 401 for any login failure — avoids user enumeration.
      const either = await Effect.runPromise(
        Effect.either(
          pipe(
            findUserByEmail(body.email),
            Effect.flatMap((user) =>
              Effect.gen(function* () {
                const valid = yield* Effect.promise(() =>
                  verifyPassword(
                    body.password,
                    user.passwordHash as Parameters<typeof verifyPassword>[1],
                  ),
                );
                if (!valid) {
                  return yield* Effect.fail("invalid" as const);
                }
                const token = yield* Effect.promise(() => jwt.sign(buildJwtClaims(user)));
                return { token, user: toUserDTO(user) };
              }),
            ),
          ),
        ),
      );
      if (Either.isLeft(either)) {
        set.status = StatusCode.ClientErrorUnauthorized;
        return { error: "Invalid email or password" };
      }
      return either.right;
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
      detail: { summary: "Login with email and password", tags: ["Auth"] },
    },
  );
