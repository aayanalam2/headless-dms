import { inject, injectable } from "tsyringe";
import { Effect, pipe } from "effect";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAuditRepository } from "./audit.repository.port.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import { parsePagination } from "@domain/utils/pagination.ts";
import { ListAuditLogsQuerySchema, type ListAuditLogsQueryEncoded } from "./dtos/commands.dto.ts";
import { toPaginatedAuditLogsDTO, type PaginatedAuditLogsDTO } from "./dtos/audit-log.dto.ts";
import {
  AuditWorkflowError,
  type AuditWorkflowError as WorkflowError,
} from "./audit-workflow.errors.ts";

@injectable()
export class AuditWorkflows {
  constructor(@inject(TOKENS.AuditRepository) private readonly auditRepo: IAuditRepository) {}

  listAuditLogs(raw: ListAuditLogsQueryEncoded): Effect.Effect<PaginatedAuditLogsDTO, WorkflowError> {
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
          this.auditRepo.listAuditLogs(params),
          Effect.mapError((e) => AuditWorkflowError.unavailable("repo.listAuditLogs", e)),
          Effect.map(toPaginatedAuditLogsDTO),
        );
      }),
    );
  }
}
