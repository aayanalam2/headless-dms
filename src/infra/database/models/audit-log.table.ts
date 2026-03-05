import { index, jsonb, pgTable, uuid } from "drizzle-orm/pg-core";
import { SharedColumns } from "@infra/database/utils/shared-columns.ts";
import { auditActionEnum, auditResourceTypeEnum } from "./enums.ts";
import type { AuditAction, AuditResourceType } from "@domain/utils/enums.ts";

export const auditLogsTable = pgTable(
  "audit_logs",
  {
    ...SharedColumns,
    actorId: uuid("actor_id").notNull(),
    action: auditActionEnum("action").notNull().$type<AuditAction>(),
    resourceType: auditResourceTypeEnum("resource_type").notNull().$type<AuditResourceType>(),
    resourceId: uuid("resource_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

export type AuditLogRow = typeof auditLogsTable.$inferSelect;
export type NewAuditLogRow = typeof auditLogsTable.$inferInsert;
