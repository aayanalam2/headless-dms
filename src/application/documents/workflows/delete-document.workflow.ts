import { Effect, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { assertAdminOnly, requireDocument } from "../document.helpers.ts";
import {
  DeleteDocumentCommandSchema,
  type DeleteDocumentCommandEncoded,
} from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";
import { eventBus } from "@infra/event-bus.ts";
import { DocumentEvent } from "@domain/events/document.events.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeleteDocumentDeps = { readonly documentRepo: IDocumentRepository };

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export function deleteDocument(
  deps: DeleteDocumentDeps,
  raw: DeleteDocumentCommandEncoded,
): Effect.Effect<void, WorkflowError> {
  return pipe(
    decodeCommand(DeleteDocumentCommandSchema, raw, DocumentWorkflowError.invalidInput),
    Effect.flatMap((cmd) =>
      pipe(
        assertAdminOnly(cmd.actor, PermissionAction.Delete),
        Effect.flatMap(() => requireDocument(deps.documentRepo, cmd.documentId)),
        Effect.flatMap((document) =>
          pipe(
            document.softDelete(),
            Effect.mapError((e) => DocumentWorkflowError.conflict(e.message)),
          ),
        ),
        Effect.flatMap((deleted) =>
          pipe(
            deps.documentRepo.update(deleted),
            Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.update", e)),
          ),
        ),
        Effect.tap(() =>
          Effect.sync(() =>
            eventBus.emit(DocumentEvent.Deleted, {
              actorId: cmd.actor.userId,
              resourceId: cmd.documentId,
            }),
          ),
        ),
      ),
    ),
  );
}
