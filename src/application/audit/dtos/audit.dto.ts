import { Schema as S } from "effect";
import { AuditResourceType } from "@domain/utils/enums.ts";
import type { AuditLogEntry } from "../audit.repository.port.ts";
import type { Paginated } from "@domain/utils/pagination.ts";
import { ActorCommandSchema } from "@application/shared/actor.ts";
import { PaginationQuerySchema } from "@application/shared/pagination.ts";

// ===========================================================================
// INBOUND — Command / Query schemas
// ===========================================================================

export const ListAuditLogsQuerySchema = S.Struct({
  ...PaginationQuerySchema.fields,
  actor: ActorCommandSchema,
  resourceType: S.optional(S.Enums(AuditResourceType)),
  resourceId: S.optional(S.String),
});
export type ListAuditLogsQueryEncoded = S.Schema.Encoded<typeof ListAuditLogsQuerySchema>;
export type ListAuditLogsQuery = S.Schema.Type<typeof ListAuditLogsQuerySchema>;

// ===========================================================================
// OUTBOUND — Response DTO types + mapper
// AuditLogEntry is already the correct outbound shape; no separate schema
// is needed. Naming it as a DTO type keeps the application layer's API
// surface explicit without duplicating the definition.
// ===========================================================================

export type AuditLogDTO = AuditLogEntry;
export type PaginatedAuditLogsDTO = Paginated<AuditLogEntry>;
