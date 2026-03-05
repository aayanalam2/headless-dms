import { Elysia, t } from "elysia";
import { Effect, pipe } from "effect";
import { adminPlugin } from "../middleware/auth.plugin.ts";
import type { IAuditRepository } from "@application/audit/audit.repository.port.ts";
import { listAuditLogs } from "@application/audit/workflows/list-audit-logs.workflow.ts";
import {
  AuditWorkflowErrorTag,
  type AuditWorkflowError,
} from "@application/audit/audit-workflow.errors.ts";
import { AppError } from "@infra/errors.ts";
import type { AuditResourceType } from "@domain/utils/enums.ts";
import { run, assertNever } from "../lib/http.ts";

// ---------------------------------------------------------------------------
// Error bridge
// ---------------------------------------------------------------------------

function toAppError(e: AuditWorkflowError): AppError {
  switch (e._tag) {
    case AuditWorkflowErrorTag.InvalidInput:
      return AppError.validation(e.message);
    case AuditWorkflowErrorTag.Unavailable:
      return AppError.database(e.operation);
    default:
      return assertNever(e);
  }
}

// ---------------------------------------------------------------------------
// createAuditController
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAuditController(auditRepo: IAuditRepository) {
  return new Elysia({ prefix: "/audit" }).use(adminPlugin).get(
    "/",
    ({ query, set }) =>
      run(
        set,
        pipe(
          listAuditLogs(
            { auditRepo },
            {
              ...query,
              // The Elysia schema validates `resourceType` as a raw string; the
              // workflow's decodeCommand will validate it against AuditResourceType enum.
              resourceType: query.resourceType as AuditResourceType | undefined,
            },
          ),
          Effect.mapError(toAppError),
        ),
      ),
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 1 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        resourceType: t.Optional(t.String()),
        resourceId: t.Optional(t.String()),
      }),
      detail: { summary: "List audit logs (admin only)", tags: ["Audit"] },
    },
  );
}
