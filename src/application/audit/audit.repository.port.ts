import type { AuditAction, AuditResourceType } from "@domain/utils/enums.ts";
import type { Paginated, PaginationParams } from "@domain/utils/pagination.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

// ---------------------------------------------------------------------------
// AuditLogEntry — plain domain representation of an audit log row.
//
// Independent of any persistence model (Drizzle row, ORM entity, etc.) so
// that callers and controllers never import infrastructure types.
// ---------------------------------------------------------------------------

export type AuditLogEntry = {
  readonly id: string;
  readonly createdAt: string;
  readonly actorId: string;
  readonly action: AuditAction;
  readonly resourceType: AuditResourceType;
  readonly resourceId: string;
  readonly metadata: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// AuditQueryParams — inputs for the list query.
// Filters are all optional; absent filters are treated as "no filter".
// ---------------------------------------------------------------------------

export type AuditQueryParams = PaginationParams & {
  readonly resourceType?: AuditResourceType;
  readonly resourceId?: string;
};

// ---------------------------------------------------------------------------
// IAuditRepository — read-only persistence port for audit log queries.
//
// Write side (insertAuditLog) belongs to the event-bus listener which uses
// the models-layer IDocumentRepository directly — it lives outside the
// workflows and does not need to be exposed here.
// ---------------------------------------------------------------------------

export interface IAuditRepository {
  listAuditLogs(params: AuditQueryParams): RepositoryEffect<Paginated<AuditLogEntry>>;
}
