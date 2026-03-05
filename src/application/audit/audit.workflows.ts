import { inject, injectable } from "tsyringe";
import type { Effect } from "effect";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IAuditRepository } from "./audit.repository.port.ts";
import { listAuditLogs } from "./workflows/list-audit-logs.workflow.ts";
import type { ListAuditLogsQueryEncoded } from "./dtos/commands.dto.ts";
import type { AuditWorkflowError } from "./audit-workflow.errors.ts";
import type { PaginatedAuditLogsDTO } from "./dtos/audit-log.dto.ts";

// ---------------------------------------------------------------------------
// AuditWorkflows — injectable application service wrapping all audit workflow
// functions.  Controllers receive this class via DI instead of building raw
// deps objects manually.
// ---------------------------------------------------------------------------

@injectable()
export class AuditWorkflows {
  constructor(
    @inject(TOKENS.AuditRepository) private readonly auditRepo: IAuditRepository,
  ) {}

  listAuditLogs(
    raw: ListAuditLogsQueryEncoded,
  ): Effect.Effect<PaginatedAuditLogsDTO, AuditWorkflowError> {
    return listAuditLogs({ auditRepo: this.auditRepo }, raw);
  }
}
