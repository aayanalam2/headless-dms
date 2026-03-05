import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { StatusCode } from "status-code-enum";
import { config } from "@infra/config/env.ts";
import type { JwtClaims } from "@application/users/dtos/user.dto.ts";
import { Role } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// JWT payload schema — validated at sign and verify time by @elysiajs/jwt.
// Keeping this co-located with the plugin ensures sign/verify always agree
// on shape.
// ---------------------------------------------------------------------------

const jwtPayloadSchema = t.Object({
  userId: t.String(),
  email: t.String(),
  role: t.Union([t.Literal(Role.Admin), t.Literal(Role.User)]),
});

// ---------------------------------------------------------------------------
// jwtPlugin — decorates context with `ctx.jwt` (sign / verify).
// Named "jwt" to avoid double-registration when used by multiple controllers.
// ---------------------------------------------------------------------------

export const jwtPlugin = new Elysia({ name: "jwt" }).use(
  jwt({
    name: "jwt",
    secret: config.jwtSecret,
    alg: "HS256",
    exp: "7d",
    schema: jwtPayloadSchema,
  }),
);

// ---------------------------------------------------------------------------
// authPlugin — decodes the Authorization: Bearer <token> header and adds
// `ctx.user: JwtClaims` to the context.
//
// Scope is "scoped" so the user property propagates to any Elysia app that
// .use(authPlugin) but does not bleed into unrelated trees.
//
// Throws 401 (via Elysia's error helper) if the token is missing or invalid.
// The error is caught by Elysia's lifecycle and turned into an HTTP response.
// ---------------------------------------------------------------------------

export const authPlugin = new Elysia({ name: "auth" })
  .use(jwtPlugin)
  .resolve({ as: "scoped" }, async ({ jwt, request, set }): Promise<{ user: JwtClaims }> => {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      set.status = StatusCode.ClientErrorUnauthorized;
      throw new Error("Unauthorized: missing or malformed token");
    }

    const token = authHeader.slice(7);
    const payload = await jwt.verify(token);

    if (!payload) {
      set.status = StatusCode.ClientErrorUnauthorized;
      throw new Error("Unauthorized: invalid or expired token");
    }

    return {
      user: {
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
      } satisfies JwtClaims,
    };
  });

// ---------------------------------------------------------------------------
// adminPlugin — extends authPlugin with an additional guard that rejects
// non-admin users with 403.
// ---------------------------------------------------------------------------

export const adminPlugin = new Elysia({ name: "admin" })
  .use(authPlugin)
  .onBeforeHandle({ as: "scoped" }, ({ user, set }) => {
    if (!user || user.role !== Role.Admin) {
      set.status = StatusCode.ClientErrorForbidden;
      return { error: "Forbidden: admin access required" };
    }
  });
