import { check, index, pgTable, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { SharedColumns } from "../utils/shared-columns.ts";
import { documentsTable } from "./document.table.ts";
import { usersTable } from "./user.table.ts";
import { permissionActionEnum, policyEffectEnum, roleEnum } from "./enums.ts";
import type { PermissionAction, PolicyEffect } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import type { Role } from "@domain/utils/enums.ts";

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
    subjectId: uuid("subject_id").references(() => usersTable.id, { onDelete: "cascade" }),
    subjectRole: roleEnum("subject_role").$type<Role>(),
    action: permissionActionEnum("action").notNull().$type<PermissionAction>(),
    effect: policyEffectEnum("effect").notNull().$type<PolicyEffect>(),
  },
  (t) => [
    index("access_policies_document_idx").on(t.documentId),
    index("access_policies_subject_idx").on(t.subjectId),
    /**
     * XOR constraint: exactly one of (subject_id, subject_role) must be set.
     * Mirrors the domain entity invariant at the database level.
     */
    check(
      "access_policies_subject_xor_chk",
      sql`(${t.subjectId} IS NOT NULL AND ${t.subjectRole} IS NULL)
          OR (${t.subjectId} IS NULL AND ${t.subjectRole} IS NOT NULL)`,
    ),
  ],
);

export type AccessPolicyRow = typeof accessPoliciesTable.$inferSelect;
export type NewAccessPolicyRow = typeof accessPoliciesTable.$inferInsert;
