import { index, pgTable, uuid } from "drizzle-orm/pg-core";
import { SharedColumns } from "@infra/database/utils/shared-columns.ts";
import { documentsTable } from "./document.table.ts";
import { usersTable } from "./user.table.ts";
import { permissionActionEnum, policyEffectEnum } from "./enums.ts";
import type {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";

// ---------------------------------------------------------------------------
// access_policies table
// ---------------------------------------------------------------------------

export const accessPoliciesTable = pgTable(
  "access_policies",
  {
    ...SharedColumns,
    documentId: uuid("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    action: permissionActionEnum("action").notNull().$type<PermissionAction>(),
    effect: policyEffectEnum("effect").notNull().$type<PolicyEffect>(),
  },
  (t) => [
    index("access_policies_document_idx").on(t.documentId),
    index("access_policies_subject_idx").on(t.subjectId),
  ],
);

export type AccessPolicyRow = typeof accessPoliciesTable.$inferSelect;
export type NewAccessPolicyRow = typeof accessPoliciesTable.$inferInsert;
