import { Effect, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { toDocumentDTO, type DocumentDTO } from "../dtos/document.dto.ts";
import { assertDocumentAccess, requireActiveDocument } from "../document.helpers.ts";
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
    Effect.flatMap((query) =>
      pipe(
        requireActiveDocument(deps.documentRepo, query.documentId),
        Effect.flatMap((document) => assertDocumentAccess(document, query.actor, "read")),
        Effect.map(toDocumentDTO),
      ),
    ),
  );
}
