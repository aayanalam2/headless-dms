import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { StatusCode } from "status-code-enum";
import { config } from "./config/env.ts";
import { logger } from "./lib/logger.ts";
import { db } from "./models/db/connection.ts";
import { createDrizzleDocumentRepository } from "./models/adapters/drizzle.document.repository.ts";
import { createDrizzleUserRepository } from "./models/adapters/drizzle.user.repository.ts";
import { createS3Storage } from "./infra/repositories/s3.storage.ts";
import { createDocumentUploadService } from "./services/document.upload.service.ts";
import { createAuditListeners } from "./services/audit.listener.ts";
import { createAuthController } from "./controllers/auth.controller.ts";
import { createDocumentsController } from "./controllers/documents.controller.ts";
import { createAuditController } from "./controllers/audit.controller.ts";

// ---------------------------------------------------------------------------
// Application factory — wires together all controllers, middleware, and
// cross-cutting concerns (CORS, Swagger, error handling, request logging).
// ---------------------------------------------------------------------------

const docRepo = createDrizzleDocumentRepository(db);
const userRepo = createDrizzleUserRepository(db);
const storageService = createS3Storage(config.s3, config.s3.bucket, config.presignTtlSeconds);

// Build services
const uploadService = createDocumentUploadService(docRepo, storageService);

// Build controllers
const authController = createAuthController(userRepo);
const documentsController = createDocumentsController(docRepo, storageService, uploadService);
const auditController = createAuditController(docRepo);

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

createAuditListeners(docRepo).register();
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
