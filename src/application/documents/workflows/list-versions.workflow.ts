import { Effect, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { toVersionDTO, type VersionDTO } from "../dtos/document.dto.ts";
import { assertDocumentAccess, requireActiveDocument } from "../document.helpers.ts";
import { ListVersionsQuerySchema, type ListVersionsQueryEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListVersionsDeps = { readonly documentRepo: IDocumentRepository };

// ---------------------------------------------------------------------------
// Workflow — linear pipe
// ---------------------------------------------------------------------------

export function listVersions(
  deps: ListVersionsDeps,
  raw: ListVersionsQueryEncoded,
): Effect.Effect<VersionDTO[], WorkflowError> {
  return pipe(
    decodeCommand(ListVersionsQuerySchema, raw, DocumentWorkflowError.invalidInput),
    Effect.flatMap((query) =>
      pipe(
        requireActiveDocument(deps.documentRepo, query.documentId),
        Effect.flatMap((document) =>
          assertDocumentAccess(document, query.actor, "list versions of"),
        ),
        Effect.flatMap((document) =>
          pipe(
            deps.documentRepo.findVersionsByDocument(document.id),
            Effect.mapError((e) =>
              DocumentWorkflowError.unavailable("repo.findVersionsByDocument", e),
            ),
          ),
        ),
        Effect.map((versions) => versions.map(toVersionDTO)),
      ),
    ),
  );
}
