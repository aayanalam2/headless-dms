import { Elysia, t } from "elysia";
import { jwtPlugin } from "../middleware/auth.plugin.ts";
import { findUserByEmail, createUser } from "../models/user.repository.ts";
import {
  hashPassword,
  verifyPassword,
  buildJwtClaims,
} from "../services/auth.service.ts";
import { Email } from "../types/branded.ts";
import { toUserDTO } from "../dto/user.dto.ts";
import { mapErrorToResponse } from "../lib/http.ts";
import { config } from "../config/env.ts";

// ---------------------------------------------------------------------------
// Auth controller — thin orchestration only.
// Business logic lives in services; data access lives in repositories.
// ---------------------------------------------------------------------------

export const authController = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin)

  // -------------------------------------------------------------------------
  // POST /auth/register
  // Creates a new user account and returns a JWT + user DTO.
  // -------------------------------------------------------------------------
  .post(
    "/register",
    async ({ body, jwt, set }) => {
      // Validate email as branded type
      const emailResult = Email.create(body.email);
      if (emailResult.isErr()) {
        set.status = 422;
        return { error: "Invalid email address" };
      }

      // Check for duplicate email
      const existing = await findUserByEmail(body.email);
      if (existing.isOk()) {
        set.status = 409;
        return { error: "An account with this email already exists" };
      }
      // A NotFound error means the email is free — any other error is unexpected
      if (
        existing.isErr() &&
        existing.unwrapErr().tag !== "NotFound"
      ) {
        const mapped = mapErrorToResponse(existing.unwrapErr());
        set.status = mapped.status;
        return mapped.body;
      }

      // Hash password and create user
      const passwordHash = await hashPassword(body.password, config.bcryptRounds);
      const createResult = await createUser({
        email: body.email,
        passwordHash: passwordHash as string,
        role: body.role ?? "user",
      });

      if (createResult.isErr()) {
        const mapped = mapErrorToResponse(createResult.unwrapErr());
        set.status = mapped.status;
        return mapped.body;
      }

      const user = createResult.unwrap();
      const claims = buildJwtClaims(user);
      const token = await jwt.sign(claims);

      return {
        token,
        user: toUserDTO(user),
      };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8 }),
        role: t.Optional(t.Union([t.Literal("admin"), t.Literal("user")])),
      }),
      detail: {
        summary: "Register a new user",
        tags: ["Auth"],
      },
    },
  )

  // -------------------------------------------------------------------------
  // POST /auth/login
  // Verifies credentials and returns a JWT + user DTO.
  // -------------------------------------------------------------------------
  .post(
    "/login",
    async ({ body, jwt, set }) => {
      // Look up user — return generic 401 to avoid user enumeration
      const userResult = await findUserByEmail(body.email);
      if (userResult.isErr()) {
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      const user = userResult.unwrap();
      const valid = await verifyPassword(
        body.password,
        user.passwordHash as Parameters<typeof verifyPassword>[1],
      );

      if (!valid) {
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      const claims = buildJwtClaims(user);
      const token = await jwt.sign(claims);

      return {
        token,
        user: toUserDTO(user),
      };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
      detail: {
        summary: "Login with email and password",
        tags: ["Auth"],
      },
    },
  );
