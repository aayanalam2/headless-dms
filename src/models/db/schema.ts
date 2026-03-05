export {
  // Enums
  roleEnum,
  permissionActionEnum,
  policyEffectEnum,
  // Tables
  usersTable as users,
  documentsTable as documents,
  documentVersionsTable as documentVersions,
  accessPoliciesTable,
  auditLogsTable as auditLogs,
  // Row types
  type UserRow,
  type NewUserRow,
  type DocumentRow,
  type NewDocumentRow,
  type VersionRow,
  type NewVersionRow,
  type AccessPolicyRow,
  type NewAccessPolicyRow,
  type AuditLogRow,
  type NewAuditLogRow,
} from "../../infra/database/schema.ts";
