import { Effect, Option, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentId } from "@domain/utils/refined.types.ts";
import { toVersionDTO, type VersionDTO } from "../dtos/document.dto.ts";
import { assertDocumentAccess } from "../document.helpers.ts";
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
      );
    }),
  );
}
