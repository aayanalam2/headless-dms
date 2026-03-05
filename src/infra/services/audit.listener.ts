import { Effect } from "effect";
import type { IAuditRepository } from "@application/audit/audit.repository.port.ts";
import { AuditAction, AuditResourceType } from "@domain/utils/enums.ts";
import { DocumentEvent } from "@domain/events/document.events.ts";
import { eventBus } from "@infra/event-bus.ts";

// ---------------------------------------------------------------------------
// createAuditListeners
//
// Binds domain events to audit-log writes via the IAuditRepository port.
// Call register() once at startup.
// ---------------------------------------------------------------------------

function fire(effect: Effect.Effect<unknown, unknown>): void {
  Effect.runFork(Effect.ignoreLogged(effect));
}

export function createAuditListeners(
  auditRepo: IAuditRepository,
): { register(): void } {
  return {
    register() {
      eventBus.on(DocumentEvent.Uploaded, (e) =>
        fire(
          auditRepo.insertAuditLog({
            actorId: e.actorId,
            action: AuditAction.DocumentUpload,
            resourceType: AuditResourceType.Document,
            resourceId: e.resourceId,
            metadata: {
              versionId: e.versionId,
              filename: e.filename,
              contentType: e.contentType,
            },
          }),
        ),
      );

      eventBus.on(DocumentEvent.VersionCreated, (e) =>
        fire(
          auditRepo.insertAuditLog({
            actorId: e.actorId,
            action: AuditAction.DocumentVersionCreate,
            resourceType: AuditResourceType.Document,
            resourceId: e.resourceId,
            metadata: {
              versionId: e.versionId,
              versionNumber: String(e.versionNumber),
              filename: e.filename,
            },
          }),
        ),
      );

      eventBus.on(DocumentEvent.Deleted, (e) =>
        fire(
          auditRepo.insertAuditLog({
            actorId: e.actorId,
            action: AuditAction.DocumentDelete,
            resourceType: AuditResourceType.Document,
            resourceId: e.resourceId,
            metadata: {},
          }),
        ),
      );
    },
  };
}
