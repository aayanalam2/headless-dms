import { and, count, desc, eq } from "drizzle-orm";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type {
  IAuditRepository,
  AuditLogEntry,
  AuditQueryParams,
  NewAuditLogInput,
} from "@application/audit/audit.repository.port.ts";
import type { AuditLogRow } from "@infra/database/schema.ts";
import { auditLogsTable } from "@infra/database/models/audit-log.table.ts";
import type { Paginated } from "@domain/utils/pagination.ts";
import { buildPageInfo } from "@domain/utils/pagination.ts";
import { executeQuery } from "@infra/database/utils/query-helpers.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

// ---------------------------------------------------------------------------
// DrizzleAuditRepository
//
// Persistence adapter for audit log reads and writes.
// ---------------------------------------------------------------------------

export class DrizzleAuditRepository implements IAuditRepository {
  constructor(private readonly db: AppDb) {}

  // -------------------------------------------------------------------------
  // Row ↔ entry
  // -------------------------------------------------------------------------

  private static readonly fromRow = (row: AuditLogRow): AuditLogEntry => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadata,
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  insertAuditLog(input: NewAuditLogInput): RepositoryEffect<void> {
    const now = new Date();
    return executeQuery(() =>
      this.db.insert(auditLogsTable).values({
        id: crypto.randomUUID(),
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  listAuditLogs(params: AuditQueryParams): RepositoryEffect<Paginated<AuditLogEntry>> {
    const { page, limit, resourceType, resourceId } = params;
    const offset = (page - 1) * limit;

    return executeQuery(async () => {
      // Build filters conditionally — exactOptionalPropertyTypes forbids
      // passing `undefined` for columns typed without `| undefined`.
      const conditions = [];
      if (resourceType !== undefined) {
        conditions.push(eq(auditLogsTable.resourceType, resourceType));
      }
      if (resourceId !== undefined) {
        conditions.push(eq(auditLogsTable.resourceId, resourceId));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [countResult, rows] = await Promise.all([
        this.db.select({ total: count() }).from(auditLogsTable).where(where),
        this.db
          .select()
          .from(auditLogsTable)
          .where(where)
          .orderBy(desc(auditLogsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      const total = countResult[0]?.total ?? 0;

      return {
        items: rows.map(DrizzleAuditRepository.fromRow),
        pageInfo: buildPageInfo(total, page, limit),
      };
    });
  }
}
