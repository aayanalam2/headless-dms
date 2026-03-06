import { Schema as S } from "effect";
import { AuditResourceType } from "@domain/utils/enums.ts";
import type { AuditLogEntry } from "../audit.repository.port.ts";
import type { Paginated } from "@domain/utils/pagination.ts";

// ===========================================================================
// INBOUND — Command / Query schemas
// ===========================================================================

export const ListAuditLogsQuerySchema = S.Struct({
  page: S.optional(S.Union(S.Number, S.NumberFromString)),
  limit: S.optional(S.Union(S.Number, S.NumberFromString)),
  resourceType: S.optional(S.Enums(AuditResourceType)),
  resourceId: S.optional(S.String),
});
export type ListAuditLogsQueryEncoded = S.Schema.Encoded<typeof ListAuditLogsQuerySchema>;
export type ListAuditLogsQuery = S.Schema.Type<typeof ListAuditLogsQuerySchema>;

// ===========================================================================
// OUTBOUND — Response DTO types + mapper
// AuditLogEntry is already the correct outbound shape; no separate schema
// is needed. Naming it as a DTO type keeps the application layer's API
// surface explicit without duplicating the definition.
// ===========================================================================

export type AuditLogDTO = AuditLogEntry;
export type PaginatedAuditLogsDTO = Paginated<AuditLogEntry>;

export function toPaginatedAuditLogsDTO(
  paginated: Paginated<AuditLogEntry>,
): PaginatedAuditLogsDTO {
  return paginated;
}
