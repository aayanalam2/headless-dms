import "reflect-metadata";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { StatusCode } from "status-code-enum";
import { config } from "@infra/config/env.ts";
import { logger } from "./presentation/http/lib/logger.ts";
import { createDb } from "@infra/database/utils/connection.ts";
import { createS3Storage } from "@infra/repositories/s3.storage.ts";
import { createAuditListeners } from "@infra/services/audit.listener.ts";
import { buildContainer } from "@infra/di/container.ts";
import { DocumentWorkflows } from "@application/documents/document.workflows.ts";
import { UserWorkflows } from "@application/users/user.workflows.ts";
import { AuditWorkflows } from "@application/audit/audit.workflows.ts";
import { AccessPolicyWorkflows } from "@application/access-policy/workflows/access-policy.workflows.ts";
import { createAuthController } from "./presentation/http/controllers/auth.controller.ts";
import { createDocumentsController } from "./presentation/http/controllers/documents.controller.ts";
import { createAuditController } from "./presentation/http/controllers/audit.controller.ts";
import { createAccessPolicyController } from "./presentation/http/controllers/access-policy.controller.ts";
import { DrizzleAuditRepository } from "@infra/repositories/drizzle-audit.repository.ts";

// ---------------------------------------------------------------------------
// Application factory — wires together all controllers, middleware, and
// cross-cutting concerns (CORS, Swagger, error handling, request logging).
// ---------------------------------------------------------------------------

const { db } = createDb(config.databaseUrl);
const storageService = createS3Storage(config.s3, config.s3.bucket, config.presignTtlSeconds);

// Build and configure the DI container.
const diContainer = buildContainer(db, storageService);

// Resolve workflow classes from the container.
const documentWorkflows = diContainer.resolve(DocumentWorkflows);
const userWorkflows = diContainer.resolve(UserWorkflows);
const auditWorkflows = diContainer.resolve(AuditWorkflows);
const accessPolicyWorkflows = diContainer.resolve(AccessPolicyWorkflows);

// Build controllers (thin — all logic lives in application-layer workflows).
const authController = createAuthController(userWorkflows);
const documentsController = createDocumentsController(documentWorkflows);
const auditController = createAuditController(auditWorkflows);
const accessPolicyController = createAccessPolicyController(accessPolicyWorkflows);

// Audit listeners still need the raw repository (event bus doesn't go through DI).
const auditRepo = new DrizzleAuditRepository(db);

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
              { name: "Access Policies", description: "Document access control" },
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
      .use(accessPolicyController)

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

createAuditListeners(auditRepo).register();
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
