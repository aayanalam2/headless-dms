import { inject, injectable } from "tsyringe";
import { Effect as E, pipe } from "effect";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAuditRepository } from "../audit.repository.port.ts";
import { type AuditWorkflowError as WorkflowError } from "../audit-workflow.errors.ts";
import {
  ListAuditLogsQuerySchema,
  type ListAuditLogsQueryEncoded,
  type PaginatedAuditLogsDTO,
} from "../dtos/audit.dto.ts";
import { decode, assertAdminAccess, paginateAuditLogs } from "./steps/audit.workflow.helpers.ts";

@injectable()
export class AuditWorkflows {
  constructor(@inject(TOKENS.AuditRepository) private readonly auditRepo: IAuditRepository) {}

  listAuditLogs(raw: ListAuditLogsQueryEncoded): E.Effect<PaginatedAuditLogsDTO, WorkflowError> {
    return pipe(
      decode(ListAuditLogsQuerySchema, raw),
      E.flatMap(assertAdminAccess),
      E.flatMap(paginateAuditLogs(this.auditRepo)),
    );
  }
}
