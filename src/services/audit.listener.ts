import { Effect } from "effect";
import { eventBus } from "../lib/event-bus.ts";
import type { IDocumentRepository } from "../models/document.repository.ts";
import { AuditAction, AuditResourceType } from "../types/enums.ts";
import { DocumentEvent } from "../events/document.events.ts";

// ---------------------------------------------------------------------------
// createAuditListeners
// Binds domain events to audit log writes. Call register() once at startup.
// Accepts IDocumentRepository so tests can inject an in-memory stub.
// ---------------------------------------------------------------------------

function fire(effect: Effect.Effect<unknown, unknown>): void {
  Effect.runFork(Effect.ignoreLogged(effect));
}

export function createAuditListeners(repo: IDocumentRepository): { register(): void } {
  return {
    register() {
      eventBus.on(DocumentEvent.Uploaded, (e) =>
        fire(
          repo.insertAuditLog({
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
          repo.insertAuditLog({
            actorId: e.actorId,
            action: AuditAction.DocumentVersionCreate,
            resourceType: AuditResourceType.Document,
            resourceId: e.resourceId,
            metadata: {
              versionId: e.versionId,
              versionNumber: e.versionNumber,
              filename: e.filename,
            },
          }),
        ),
      );

      eventBus.on(DocumentEvent.Deleted, (e) =>
        fire(
          repo.insertAuditLog({
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
