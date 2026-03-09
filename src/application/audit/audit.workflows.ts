import { inject, injectable } from "tsyringe";
import { Effect as E, pipe } from "effect";
import { TOKENS } from "@infra/di/tokens.ts";
import { Role } from "@domain/utils/enums.ts";
import { makeLiftRepo, assertGuard } from "@application/shared/workflow.helpers.ts";
import type { IAuditRepository } from "./audit.repository.port.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import { withPagination } from "@application/shared/pagination.ts";
import {
  ListAuditLogsQuerySchema,
  toPaginatedAuditLogsDTO,
  type ListAuditLogsQueryEncoded,
  type PaginatedAuditLogsDTO,
} from "./dtos/audit.dto.ts";
import {
  AuditWorkflowError,
  type AuditWorkflowError as WorkflowError,
} from "./audit-workflow.errors.ts";

const liftRepo = makeLiftRepo(AuditWorkflowError.unavailable);

@injectable()
export class AuditWorkflows {
  constructor(@inject(TOKENS.AuditRepository) private readonly auditRepo: IAuditRepository) {}

  listAuditLogs(raw: ListAuditLogsQueryEncoded): E.Effect<PaginatedAuditLogsDTO, WorkflowError> {
    return pipe(
      decodeCommand(ListAuditLogsQuerySchema, raw, AuditWorkflowError.invalidInput),
      E.tap((query) =>
        assertGuard(
          query.actor.role === Role.Admin,
          () => AuditWorkflowError.forbidden("Audit logs are restricted to admins"),
        ),
      ),
      E.flatMap((query) =>
        withPagination(
          query,
          (pagination) =>
            liftRepo(
              "repo.listAuditLogs",
              this.auditRepo.listAuditLogs({
                ...pagination,
                ...(query.resourceType !== undefined && { resourceType: query.resourceType }),
                ...(query.resourceId !== undefined && { resourceId: query.resourceId }),
              }),
            ),
          toPaginatedAuditLogsDTO,
        ),
      ),
    );
  }
}
