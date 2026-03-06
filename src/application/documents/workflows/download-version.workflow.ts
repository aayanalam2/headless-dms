import { Effect, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import {
  assertDocumentAccess,
  requireActiveDocument,
  requireVersion,
  requireVersionOfDocument,
} from "../document.helpers.ts";
import { toVersionDTO, type PresignedDownloadDTO } from "../dtos/document.dto.ts";
import {
  DownloadVersionQuerySchema,
  type DownloadVersionQueryEncoded,
  DEFAULT_PRESIGNED_URL_TTL_SECONDS,
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
      const ttl = query.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS;

      return pipe(
        requireActiveDocument(deps.documentRepo, query.documentId),
        Effect.flatMap((document) => assertDocumentAccess(document, query.actor, "download")),
        Effect.flatMap((document) =>
          pipe(
            requireVersion(deps.documentRepo, query.versionId),
            Effect.flatMap((version) => requireVersionOfDocument(version, document)),
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
