import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { StatusCode } from "status-code-enum";
import { config } from "./config/env.ts";
import { logger } from "./lib/logger.ts";
import { db } from "./models/db/connection.ts";
// Models-layer adapter — kept for the audit event listener (insertAuditLog).
import { createDrizzleDocumentRepository } from "./models/adapters/drizzle.document.repository.ts";
// Infra-layer repos — implement the domain port interfaces.
import { DrizzleDocumentRepository } from "./infra/repositories/drizzle-document.repository.ts";
import { DrizzleUserRepository } from "./infra/repositories/drizzle-user.repository.ts";
import { DrizzleAuditRepository } from "./infra/repositories/drizzle-audit.repository.ts";
import { createS3Storage } from "./infra/repositories/s3.storage.ts";
import { createAuditListeners } from "./services/audit.listener.ts";
import { createAuthController } from "./controllers/auth.controller.ts";
import { createDocumentsController } from "./controllers/documents.controller.ts";
import { createAuditController } from "./controllers/audit.controller.ts";

// ---------------------------------------------------------------------------
// Application factory — wires together all controllers, middleware, and
// cross-cutting concerns (CORS, Swagger, error handling, request logging).
// ---------------------------------------------------------------------------

// Models-layer doc repo — used only by the audit event listener.
const legacyDocRepo = createDrizzleDocumentRepository(db);

// Infra repos that implement domain port interfaces.
const documentRepo = new DrizzleDocumentRepository(db);
const userRepo = new DrizzleUserRepository(db);
const auditRepo = new DrizzleAuditRepository(db);
const storageService = createS3Storage(config.s3, config.s3.bucket, config.presignTtlSeconds);

// Build controllers (thin — all logic lives in application-layer workflows).
const authController = createAuthController(userRepo);
const documentsController = createDocumentsController(documentRepo, storageService);
const auditController = createAuditController(auditRepo);

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
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
          set.status = StatusCode.ClientErrorUnprocessableEntity;
          return {
            error: "Validation Error",
            detail: error.message,
          };
        }

        if (code === "NOT_FOUND") {
          set.status = StatusCode.ClientErrorNotFound;
          return { error: "Route not found" };
        }

        // Unexpected error — log to stdout (12-Factor XI)
        logger.error({ err: error, code }, "Unhandled server error");

        set.status = StatusCode.ServerErrorInternal;
        return { error: "Internal Server Error" };
      })

      // -----------------------------------------------------------------------
      // Structured JSON request log — written to stdout (12-Factor XI).
      // -----------------------------------------------------------------------
      .onAfterResponse(({ request, set }) => {
        logger.info(
          {
            method: request.method,
            path: new URL(request.url).pathname,
            status: set.status,
          },
          "request",
        );
      })
  );
}

// ---------------------------------------------------------------------------
// Entry point — parse config (fails fast on bad env), then start server.
// Config is imported first so any missing env vars cause an immediate exit
// before any other module initialises.
// ---------------------------------------------------------------------------

createAuditListeners(legacyDocRepo).register();
const app = createApp();

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      env: config.nodeEnv,
      swagger: `http://localhost:${config.port}/swagger`,
    },
    "Server started",
  );
});

export type App = typeof app;
