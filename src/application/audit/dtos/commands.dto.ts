import { Schema as S } from "effect";
import { AuditResourceType } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// ListAuditLogsQuerySchema
//
// Raw query-string input for the audit log list endpoint.
// page/limit accept both numbers and numeric strings (HTTP query strings
// always arrive as strings from the transport layer).
// ---------------------------------------------------------------------------

export const ListAuditLogsQuerySchema = S.Struct({
  page: S.optional(S.Union(S.Number, S.NumberFromString)),
  limit: S.optional(S.Union(S.Number, S.NumberFromString)),
  resourceType: S.optional(S.Enums(AuditResourceType)),
  resourceId: S.optional(S.String),
});
export type ListAuditLogsQueryEncoded = S.Schema.Encoded<
  typeof ListAuditLogsQuerySchema
>;
export type ListAuditLogsQuery = S.Schema.Type<typeof ListAuditLogsQuerySchema>;
