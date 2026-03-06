import { inject, injectable } from "tsyringe";
import { Effect, pipe } from "effect";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAuditRepository } from "./audit.repository.port.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import { withPagination } from "@domain/utils/pagination.ts";
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
      Effect.flatMap((query) =>
        withPagination(
          query,
          (pagination) =>
            pipe(
              this.auditRepo.listAuditLogs({
                ...pagination,
                ...(query.resourceType !== undefined && { resourceType: query.resourceType }),
                ...(query.resourceId !== undefined && { resourceId: query.resourceId }),
              }),
              Effect.mapError((e) => AuditWorkflowError.unavailable("repo.listAuditLogs", e)),
            ),
          toPaginatedAuditLogsDTO,
        ),
      ),
    );
  }
}
