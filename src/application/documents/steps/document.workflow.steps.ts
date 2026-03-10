import { Effect as E, pipe } from "effect";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { withPagination } from "@application/shared/pagination.ts";
import { makeDecoder } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";
import { liftRepo, scopeList } from "../services/document.repository.ts";
import {
  toDocumentDTO,
  toPaginatedDocumentsDTO,
  toVersionDTO,
  type PaginatedDocumentsDTO,
  type PresignedDownloadDTO,
  type VersionDTO,
  type UploadDocumentResult,
  DEFAULT_PRESIGNED_URL_TTL_SECONDS,
  type ListDocumentsQueryDecoded,
} from "../dtos/document.dto.ts";
import type { UploadContextCommitted, DocumentCmdWithDoc } from "./document.context.steps.ts";

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** Decode a raw input against a schema, mapping parse errors to InvalidInput. */
export const decode = makeDecoder(DocumentWorkflowError.invalidInput);

// ---------------------------------------------------------------------------
// Sync context enrichments
// ---------------------------------------------------------------------------

/** Stamps a resolved TTL onto the context, defaulting to the configured constant. */
export const withDefaultTtl = <T extends { expiresInSeconds?: number | undefined }>(
  ctx: T,
): T & { ttl: number } => ({
  ...ctx,
  ttl: ctx.expiresInSeconds ?? DEFAULT_PRESIGNED_URL_TTL_SECONDS,
});

// ---------------------------------------------------------------------------
// Effect-returning orchestration steps
// ---------------------------------------------------------------------------

/** Fetches a presigned download URL and builds the response DTO. */
export function buildPresignedCtx(
  storage: IStorage,
): (ctx: {
  version: DocumentVersion;
  ttl: number;
}) => E.Effect<PresignedDownloadDTO, WorkflowError> {
  return (ctx) =>
    pipe(
      storage.getPresignedDownloadUrl(ctx.version.bucketKey, ctx.ttl),
      E.mapError((e) => DocumentWorkflowError.unavailable(e)),
      E.map((url) => ({
        url,
        expiresAt: new Date(Date.now() + ctx.ttl * 1000).toISOString(),
        version: toVersionDTO(ctx.version),
      })),
    );
}

/** Runs the scoped list query and wraps the result in a paginated DTO. */
export function paginateDocuments(
  repo: IDocumentRepository,
): (query: ListDocumentsQueryDecoded) => E.Effect<PaginatedDocumentsDTO, WorkflowError> {
  return (query) =>
    withPagination(
      query,
      (pagination) =>
        liftRepo(
          scopeList(repo, query.actor, { ownerId: query.ownerId, name: query.name }, pagination),
        ),
      toPaginatedDocumentsDTO,
    );
}

/** Fetches all versions for the document in the context. */
export function fetchVersionsForDocument(
  repo: IDocumentRepository,
): (
  ctx: Pick<DocumentCmdWithDoc, "document">,
) => E.Effect<readonly DocumentVersion[], WorkflowError> {
  return (ctx) => liftRepo(repo.findVersionsByDocument(ctx.document.id));
}

// ---------------------------------------------------------------------------
// Pure mappers
// ---------------------------------------------------------------------------

/** Maps a committed upload context to the public result DTO. */
export const toUploadResult = (ctx: UploadContextCommitted): UploadDocumentResult => ({
  document: toDocumentDTO(ctx.updated),
  version: toVersionDTO(ctx.version),
});

/** Maps a list of version entities to version DTOs. */
export const toVersionDTOList = (versions: readonly DocumentVersion[]): readonly VersionDTO[] =>
  versions.map(toVersionDTO);
