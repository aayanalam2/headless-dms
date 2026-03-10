import { Effect as E } from "effect";
import { makeLiftRepo, makeRequireAdmin } from "@application/shared/workflow.helpers.ts";
import { withPagination } from "@application/shared/pagination.ts";
import { makeDecoder } from "@application/shared/decode.ts";
import type { IAuditRepository } from "../audit.repository.port.ts";
import {
  AuditWorkflowError,
  type AuditWorkflowError as WorkflowError,
} from "../audit-workflow.errors.ts";
import {
  type PaginatedAuditLogsDTO,
  type ListAuditLogsQuery as ListAuditLogsQueryDecoded,
} from "../dtos/audit.dto.ts";

/** Lift any effect's error to Unavailable. */
export const liftRepo = makeLiftRepo(AuditWorkflowError.unavailable);

/** Decode a raw input against a schema, mapping parse errors to InvalidInput. */
export const decode = makeDecoder(AuditWorkflowError.invalidInput);

/** Asserts that the actor is an Admin, failing with Forbidden otherwise. */
export const assertAdminAccess = makeRequireAdmin(() =>
  AuditWorkflowError.forbidden("Audit logs are restricted to admins"),
);

/** Fetches a paginated page of audit logs according to the query filters. */
export function paginateAuditLogs(
  repo: IAuditRepository,
): (query: ListAuditLogsQueryDecoded) => E.Effect<PaginatedAuditLogsDTO, WorkflowError> {
  return (query) =>
    withPagination(query, (pagination) =>
      liftRepo(
        repo.listAuditLogs({
          ...pagination,
          ...(query.resourceType !== undefined && { resourceType: query.resourceType }),
          ...(query.resourceId !== undefined && { resourceId: query.resourceId }),
        }),
      ),
    );
}
