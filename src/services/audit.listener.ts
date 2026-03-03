import { Effect } from "effect";
import { eventBus } from "../lib/event-bus.ts";
import { insertAuditLog } from "../models/document.repository.ts";
import { AuditAction, AuditResourceType } from "../types/enums.ts";
import { DocumentEvent } from "../events/document.events.ts";

// ---------------------------------------------------------------------------
// Audit listener — the single place that maps domain events → audit log rows.
// Call registerAuditListeners() once at application startup.
// ---------------------------------------------------------------------------

function fire(effect: Effect.Effect<unknown, unknown>): void {
  Effect.runFork(Effect.ignoreLogged(effect));
}

export function registerAuditListeners(): void {
  eventBus.on(DocumentEvent.Uploaded, (e) =>
    fire(
      insertAuditLog({
        actorId: e.actorId,
        action: AuditAction.DocumentUpload,
        resourceType: AuditResourceType.Document,
        resourceId: e.resourceId,
        metadata: { versionId: e.versionId, filename: e.filename, contentType: e.contentType },
      }),
    ),
  );

  eventBus.on(DocumentEvent.VersionCreated, (e) =>
    fire(
      insertAuditLog({
        actorId: e.actorId,
        action: AuditAction.DocumentVersionCreate,
        resourceType: AuditResourceType.Document,
        resourceId: e.resourceId,
        metadata: { versionId: e.versionId, versionNumber: e.versionNumber, filename: e.filename },
      }),
    ),
  );

  eventBus.on(DocumentEvent.Deleted, (e) =>
    fire(
      insertAuditLog({
        actorId: e.actorId,
        action: AuditAction.DocumentDelete,
        resourceType: AuditResourceType.Document,
        resourceId: e.resourceId,
        metadata: {},
      }),
    ),
  );
}
