import { Effect, Option, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentId } from "@domain/utils/refined.types.ts";
import { toDocumentDTO, type DocumentDTO } from "../dtos/document.dto.ts";
import { assertDocumentAccess } from "../document.helpers.ts";
import { GetDocumentQuerySchema, type GetDocumentQueryEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GetDocumentDeps = { readonly documentRepo: IDocumentRepository };

// ---------------------------------------------------------------------------
// Workflow — linear pipe
// ---------------------------------------------------------------------------

export function getDocument(
  deps: GetDocumentDeps,
  raw: GetDocumentQueryEncoded,
): Effect.Effect<DocumentDTO, WorkflowError> {
  return pipe(
    decodeCommand(GetDocumentQuerySchema, raw, DocumentWorkflowError.invalidInput),
    Effect.flatMap((query) => {
      const documentId = DocumentId.create(query.documentId).unwrap();

      return pipe(
        deps.documentRepo.findActiveById(documentId),
        Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findActiveById", e)),
        Effect.flatMap((opt) =>
          Option.isNone(opt)
            ? Effect.fail(DocumentWorkflowError.notFound(`Document '${query.documentId}'`))
            : Effect.succeed(opt.value),
        ),
        Effect.flatMap((document) => assertDocumentAccess(document, query.actor, "read")),
        Effect.map(toDocumentDTO),
      );
    }),
  );
}
