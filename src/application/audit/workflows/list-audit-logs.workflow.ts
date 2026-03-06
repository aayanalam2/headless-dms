import { Effect, pipe } from "effect";
import type { IAuditRepository } from "../audit.repository.port.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import { parsePagination } from "@domain/utils/pagination.ts";
import { ListAuditLogsQuerySchema, type ListAuditLogsQueryEncoded } from "../dtos/commands.dto.ts";
import { toPaginatedAuditLogsDTO, type PaginatedAuditLogsDTO } from "../dtos/audit-log.dto.ts";
import {
  AuditWorkflowError,
  type AuditWorkflowError as WorkflowError,
} from "../audit-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListAuditLogsDeps = { readonly auditRepo: IAuditRepository };

// ---------------------------------------------------------------------------
// Workflow — linear pipe
//
// Query-only; no authz guard here — that responsibility belongs to the
// transport layer (the audit controller applies an admin-only middleware
// before calling this workflow).
//
// 1. Decode & validate raw query-string input
// 2. Clamp pagination to safe bounds
// 3. Delegate to the repository
// 4. Map result to DTO
// ---------------------------------------------------------------------------

export function listAuditLogs(
  deps: ListAuditLogsDeps,
  raw: ListAuditLogsQueryEncoded,
): Effect.Effect<PaginatedAuditLogsDTO, WorkflowError> {
  return pipe(
    decodeCommand(ListAuditLogsQuerySchema, raw, AuditWorkflowError.invalidInput),
Effect.flatMap((query) => {
      const { page, limit } = parsePagination(query);
      const params = {
        page,
        limit,
        ...(query.resourceType !== undefined && { resourceType: query.resourceType }),
        ...(query.resourceId !== undefined && { resourceId: query.resourceId }),
      };

      return pipe(
        deps.auditRepo.listAuditLogs(params),
        Effect.mapError((e) => AuditWorkflowError.unavailable("repo.listAuditLogs", e)),
        Effect.map(toPaginatedAuditLogsDTO),
      );
    }),
  );
}
