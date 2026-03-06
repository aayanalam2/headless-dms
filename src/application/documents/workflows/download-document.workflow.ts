import { Effect, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import {
  assertDocumentAccess,
  requireActiveDocument,
  requireCurrentVersion,
} from "../document.helpers.ts";
import { toVersionDTO, type PresignedDownloadDTO } from "../dtos/document.dto.ts";
import {
  DownloadDocumentQuerySchema,
  type DownloadDocumentQueryEncoded,
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

export type DownloadDocumentDeps = {
  readonly documentRepo: IDocumentRepository;
  readonly storage: IStorage;
};

// ---------------------------------------------------------------------------
// Workflow — linear pipe
// ---------------------------------------------------------------------------

export function downloadDocument(
  deps: DownloadDocumentDeps,
  raw: DownloadDocumentQueryEncoded,
): Effect.Effect<PresignedDownloadDTO, WorkflowError> {
  return pipe(
    decodeCommand(DownloadDocumentQuerySchema, raw, DocumentWorkflowError.invalidInput),
    Effect.flatMap((query) =>
      pipe(
        requireActiveDocument(deps.documentRepo, query.documentId),
        Effect.flatMap((document) => assertDocumentAccess(document, query.actor, "download")),
        Effect.flatMap((document) => requireCurrentVersion(deps.documentRepo, document)),
        Effect.flatMap((version) =>
          pipe(
            deps.storage.getPresignedDownloadUrl(version.bucketKey, query.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS),
            Effect.mapError((e) =>
              DocumentWorkflowError.unavailable("storage.getPresignedDownloadUrl", e),
            ),
            Effect.map((url) => ({
              url,
              expiresAt: new Date(Date.now() + (query.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS) * 1000).toISOString(),
              version: toVersionDTO(version),
            })),
          ),
        ),
      ),
    ),
  );
}
