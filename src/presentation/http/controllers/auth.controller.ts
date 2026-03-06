import { Elysia, t } from "elysia";
import { Effect as E, Either, pipe } from "effect";
import { jwtPlugin } from "../middleware/auth.plugin.ts";
import { StatusCode } from "status-code-enum";
import { Role } from "@domain/utils/enums.ts";
import { makeRun } from "../lib/http.ts";
import type { UserWorkflows } from "@application/users/user.workflows.ts";
import { userWorkflowToHttp } from "../lib/error-map.ts";

const run = makeRun(userWorkflowToHttp);

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAuthController(workflows: UserWorkflows) {
  return (
    new Elysia({ prefix: "/auth" })
      .use(jwtPlugin)

      .post(
        "/register",
        ({ body, jwt, set }) =>
          run(
            set,
            pipe(
              workflows.register(body),
              E.flatMap((user) =>
                pipe(
                  E.promise(() =>
                    jwt.sign({ userId: user.id, email: user.email, role: user.role }),
                  ),
                  E.map((token) => ({ token, user })),
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

      // Security: always respond with 401 on any failure — avoids user enumeration.
      .post(
        "/login",
        async ({ body, jwt, set }) => {
          const either = await E.runPromise(E.either(workflows.login(body)));

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
