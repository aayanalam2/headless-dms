import { Schema as S } from "effect";
import { AuditAction, AuditResourceType } from "@domain/utils/enums.ts";
import type { AuditLogEntry } from "../audit.repository.port.ts";
import type { Paginated } from "@domain/utils/pagination.ts";

// ---------------------------------------------------------------------------
// AuditLogDTOSchema — outbound shape for a single audit log entry.
// ---------------------------------------------------------------------------

export const AuditLogDTOSchema = S.Struct({
  id: S.String,
  createdAt: S.String,
  actorId: S.String,
  action: S.Enums(AuditAction),
  resourceType: S.Enums(AuditResourceType),
  resourceId: S.String,
  metadata: S.Record({ key: S.String, value: S.Unknown }),
});
export type AuditLogDTO = S.Schema.Type<typeof AuditLogDTOSchema>;

// ---------------------------------------------------------------------------
// PaginatedAuditLogsDTOSchema — outbound shape for a paginated list.
// ---------------------------------------------------------------------------

export const PaginatedAuditLogsDTOSchema = S.Struct({
  items: S.Array(AuditLogDTOSchema),
  pagination: S.Struct({
    total: S.Number,
    page: S.Number,
    limit: S.Number,
    totalPages: S.Number,
  }),
});
export type PaginatedAuditLogsDTO = S.Schema.Type<
  typeof PaginatedAuditLogsDTOSchema
>;

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

export function toAuditLogDTO(entry: AuditLogEntry): AuditLogDTO {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    metadata: entry.metadata,
  };
}

export function toPaginatedAuditLogsDTO(
  paginated: Paginated<AuditLogEntry>,
): PaginatedAuditLogsDTO {
  return {
    items: paginated.items.map(toAuditLogDTO),
    pagination: {
      total: paginated.pageInfo.total,
      page: paginated.pageInfo.page,
      limit: paginated.pageInfo.limit,
      totalPages: paginated.pageInfo.totalPages,
    },
  };
}
