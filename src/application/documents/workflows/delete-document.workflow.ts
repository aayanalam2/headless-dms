import { Effect, Option, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentId, UserId } from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
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

// keep PermissionAction imported (used in access denied message)
void (null as unknown as typeof PermissionAction);

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
      Effect.gen(function* () {
        const documentId = DocumentId.create(cmd.documentId).unwrap();
        const actorId = UserId.create(cmd.actor.userId).unwrap();

        // Only admins may delete documents
        if (cmd.actor.role !== Role.Admin) {
          return yield* Effect.fail(
            DocumentWorkflowError.accessDenied(
              `User '${actorId}' does not have '${PermissionAction.Delete}' permission`,
            ),
          );
        }

        const opt = yield* pipe(
          deps.documentRepo.findById(documentId),
          Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findById", e)),
        );

        if (Option.isNone(opt)) {
          return yield* Effect.fail(DocumentWorkflowError.notFound(`Document '${cmd.documentId}'`));
        }

        const deleted = opt.value.softDelete();
        if (deleted instanceof Error) {
          return yield* Effect.fail(DocumentWorkflowError.conflict(deleted.message));
        }

        yield* pipe(
          deps.documentRepo.update(deleted),
          Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.update", e)),
        );

        eventBus.emit(DocumentEvent.Deleted, {
          actorId: cmd.actor.userId,
          resourceId: cmd.documentId,
        });
      }),
    ),
  );
}
