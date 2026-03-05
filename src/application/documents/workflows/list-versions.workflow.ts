import { Effect, Option, pipe } from "effect";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentId, UserId } from "@domain/utils/refined.types.ts";
import { isOwner } from "@domain/document/document.guards.ts";
import { Role } from "@domain/utils/enums.ts";
import { toVersionDTO, type VersionDTO } from "../dtos/document.dto.ts";
import { ListVersionsQuerySchema, type ListVersionsQueryEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// keep DocumentVersion imported so the explicit return annotation resolves
void (null as unknown as DocumentVersion);

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
      const actorId = UserId.create(query.actor.userId).unwrap();

      return pipe(
        deps.documentRepo.findActiveById(documentId),
        Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findActiveById", e)),
        Effect.flatMap((opt) =>
          Option.isNone(opt)
            ? Effect.fail(DocumentWorkflowError.notFound(`Document '${query.documentId}'`))
            : Effect.succeed(opt.value),
        ),
        Effect.flatMap(
          (document): Effect.Effect<readonly DocumentVersion[], WorkflowError> =>
            query.actor.role !== Role.Admin && !isOwner(document, actorId)
              ? Effect.fail(
                  DocumentWorkflowError.accessDenied(
                    `User '${query.actor.userId}' cannot list versions of document '${query.documentId}'`,
                  ),
                )
              : pipe(
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
