import { Effect, Option, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { DocumentId, UserId, VersionId } from "@domain/utils/refined.types.ts";
import { isOwner } from "@domain/document/document.guards.ts";
import { Role } from "@domain/utils/enums.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { toVersionDTO, type PresignedDownloadDTO } from "../dtos/document.dto.ts";
import {
  DownloadVersionQuerySchema,
  type DownloadVersionQueryEncoded,
} from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DownloadVersionDeps = {
  readonly documentRepo: IDocumentRepository;
  readonly storage: IStorage;
};

// ---------------------------------------------------------------------------
// Workflow — linear pipe
// ---------------------------------------------------------------------------

export function downloadVersion(
  deps: DownloadVersionDeps,
  raw: DownloadVersionQueryEncoded,
): Effect.Effect<PresignedDownloadDTO, WorkflowError> {
  return pipe(
    decodeCommand(DownloadVersionQuerySchema, raw, DocumentWorkflowError.invalidInput),
    Effect.flatMap((query) => {
      const documentId = DocumentId.create(query.documentId).unwrap();
      const versionId = VersionId.create(query.versionId).unwrap();
      const actorId = UserId.create(query.actor.userId).unwrap();
      const ttl = query.expiresInSeconds ?? 300;

      return pipe(
        deps.documentRepo.findActiveById(documentId),
        Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findActiveById", e)),
        Effect.flatMap((opt) =>
          Option.isNone(opt)
            ? Effect.fail(DocumentWorkflowError.notFound(`Document '${query.documentId}'`))
            : Effect.succeed(opt.value),
        ),
        Effect.flatMap((document) =>
          query.actor.role !== Role.Admin && !isOwner(document, actorId)
            ? Effect.fail(
                DocumentWorkflowError.accessDenied(
                  `User '${query.actor.userId}' cannot download document '${query.documentId}'`,
                ),
              )
            : Effect.succeed(document),
        ),
        Effect.flatMap((document) =>
          pipe(
            deps.documentRepo.findVersionById(versionId),
            Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.findVersionById", e)),
            Effect.flatMap((opt) =>
              Option.isNone(opt)
                ? Effect.fail(DocumentWorkflowError.notFound(`Version '${query.versionId}'`))
                : Effect.succeed(opt.value),
            ),
            Effect.flatMap((version) =>
              version.documentId !== document.id
                ? Effect.fail(
                    DocumentWorkflowError.notFound(
                      `Version '${query.versionId}' does not belong to document '${query.documentId}'`,
                    ),
                  )
                : Effect.succeed(version),
            ),
          ),
        ),
        Effect.flatMap((version) =>
          pipe(
            deps.storage.getPresignedDownloadUrl(version.bucketKey, ttl),
            Effect.mapError((e) =>
              DocumentWorkflowError.unavailable("storage.getPresignedDownloadUrl", e),
            ),
            Effect.map((url) => ({
              url,
              expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
              version: toVersionDTO(version),
            })),
          ),
        ),
      );
    }),
  );
}
