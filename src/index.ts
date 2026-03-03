import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { config } from "./config/env.ts";
import { authController } from "./controllers/auth.controller.ts";
import { documentsController, auditController } from "./controllers/documents.controller.ts";

// ---------------------------------------------------------------------------
// Application factory — wires together all controllers, middleware, and
// cross-cutting concerns (CORS, Swagger, error handling, request logging).
// ---------------------------------------------------------------------------

export function createApp() {
  return (
    new Elysia()

      // -----------------------------------------------------------------------
      // CORS — allow any origin in development; lock down in production by
      // setting CORS_ORIGIN env var in a future iteration.
      // -----------------------------------------------------------------------
      .use(cors())

      // -----------------------------------------------------------------------
      // Swagger UI — auto-generated from route definitions.
      // Available at /swagger in all environments.
      // -----------------------------------------------------------------------
      .use(
        swagger({
          documentation: {
            info: {
              title: "Document Management API",
              version: "1.0.0",
              description:
                "Headless document management: upload, version, search, and securely download files.",
            },
            tags: [
              { name: "Auth", description: "Authentication endpoints" },
              { name: "Documents", description: "Document management" },
              { name: "Audit", description: "Audit log access (admin)" },
            ],
          },
        }),
      )

      // -----------------------------------------------------------------------
      // Routes
      // -----------------------------------------------------------------------
      .use(authController)
      .use(documentsController)
      .use(auditController)

      // -----------------------------------------------------------------------
      // Global error handler
      // Catches unhandled exceptions (framework errors, unexpected throws) and
      // returns a consistent JSON shape. Application errors are handled inline
      // in each controller via mapErrorToResponse.
      // -----------------------------------------------------------------------
      .onError(({ code, error, set }) => {
        // Elysia has already set the status for VALIDATION / NOT_FOUND et al.
        // We just ensure the response body is JSON.
        if (code === "VALIDATION") {
          set.status = 422;
          return {
            error: "Validation Error",
            detail: error.message,
          };
        }

        if (code === "NOT_FOUND") {
          set.status = 404;
          return { error: "Route not found" };
        }

        // Unexpected error — log to stdout (12-Factor XI)
        console.error(
          JSON.stringify({
            level: "error",
            message: "Unhandled server error",
            code,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString(),
          }),
        );

        set.status = 500;
        return { error: "Internal Server Error" };
      })

      // -----------------------------------------------------------------------
      // Structured JSON request log — written to stdout (12-Factor XI).
      // -----------------------------------------------------------------------
      .onAfterResponse(({ request, set }) => {
        console.log(
          JSON.stringify({
            level: "info",
            method: request.method,
            path: new URL(request.url).pathname,
            status: set.status,
            timestamp: new Date().toISOString(),
          }),
        );
      })
  );
}

// ---------------------------------------------------------------------------
// Entry point — parse config (fails fast on bad env), then start server.
// Config is imported first so any missing env vars cause an immediate exit
// before any other module initialises.
// ---------------------------------------------------------------------------

const app = createApp();

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Server started",
      port: config.port,
      env: config.nodeEnv,
      swagger: `http://localhost:${config.port}/swagger`,
      timestamp: new Date().toISOString(),
    }),
  );
});

export type App = typeof app;
