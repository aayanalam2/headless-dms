import { Elysia, t } from "elysia";
import { adminPlugin } from "../middleware/auth.plugin.ts";
import type { AuditResourceType } from "@domain/utils/enums.ts";
import { makeRun } from "../lib/http.ts";
import type { AuditWorkflows } from "@application/audit/audit.workflows.ts";
import { auditWorkflowToHttp } from "../lib/error-map.ts";

const run = makeRun(auditWorkflowToHttp);

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAuditController(workflows: AuditWorkflows) {
  return new Elysia({ prefix: "/audit" }).use(adminPlugin).get(
    "/",
    ({ query, set }) =>
      run(
        set,
        workflows.listAuditLogs({
          ...query,
          // The Elysia schema validates `resourceType` as a raw string; the
          // workflow's decodeCommand will validate it against AuditResourceType enum.
          resourceType: query.resourceType as AuditResourceType | undefined,
        }),
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
