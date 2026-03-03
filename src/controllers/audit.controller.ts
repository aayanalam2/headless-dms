import { Elysia, t } from "elysia";
import { Effect, Option, pipe } from "effect";
import { adminPlugin } from "../middleware/auth.plugin.ts";
import { listAuditLogs } from "../models/document.repository.ts";
import { run } from "../lib/http.ts";

export const auditController = new Elysia({ prefix: "/audit" }).use(adminPlugin).get(
  "/",
  ({ query, set }) => {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    return run(
      set,
      pipe(
        listAuditLogs({
          page,
          limit,
          resourceType: Option.fromNullable(query.resourceType),
          resourceId: Option.fromNullable(query.resourceId),
        }),
        Effect.map(({ items, total }) => ({
          items,
          pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        })),
      ),
    );
  },
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
