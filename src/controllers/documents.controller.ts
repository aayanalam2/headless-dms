import { Elysia, t } from "elysia";
import { Effect, Option, pipe } from "effect";
import { authPlugin } from "../middleware/auth.plugin.ts";
import type { IDocumentRepository } from "../models/document.repository.ts";
import type { IStorage } from "../models/storage.ts";
import type { DocumentUploadService } from "../services/document.upload.service.ts";
import { parseSearchParams } from "../services/search.service.ts";
import { BucketKey } from "../types/branded.ts";
import { toDocumentDTO, toVersionDTO, toPaginatedDocumentsDTO } from "../dto/document.dto.ts";
import { run } from "../lib/http.ts";
import { eventBus } from "../lib/event-bus.ts";
import { DocumentEvent } from "../events/document.events.ts";
import { AppError } from "../types/errors.ts";
import { Role } from "../types/enums.ts";
import { requireRole } from "../services/auth.service.ts";
import type { VersionRow } from "../models/db/schema.ts";

// ---------------------------------------------------------------------------
// validateBucketKey — thin bridge from branded-type parse into AppError.
// ---------------------------------------------------------------------------
function validateBucketKey(raw: string): Effect.Effect<BucketKey, AppError> {
  const r = BucketKey.create(raw);
  return r.isOk()
    ? Effect.succeed(r.unwrap())
    : Effect.fail(AppError.storage("Invalid stored bucket key"));
}

// ---------------------------------------------------------------------------
// createDocumentsController
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createDocumentsController(
  docRepo: IDocumentRepository,
  storage: IStorage,
  uploadService: DocumentUploadService,
) {
  const presignedDownload = (version: VersionRow) =>
    pipe(
      validateBucketKey(version.bucketKey),
      Effect.flatMap((key) => storage.getPresignedDownloadUrl(key)),
      Effect.map((url) => ({
        url,
        expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
        version: toVersionDTO(version),
      })),
    );

  return (
    new Elysia({ prefix: "/documents" })
      .use(authPlugin)

      // POST /documents — upload a new document (first version)
      .post(
        "/",
        ({ body, user, set }) =>
          run(
            set,
            uploadService.uploadDocument({
              file: body.file,
              name: Option.fromNullable(body.name),
              rawTags: Option.fromNullable(body.tags),
              rawMetadata: Option.fromNullable(body.metadata),
              userId: user.userId,
            }),
          ),
        {
          type: "formdata",
          body: t.Object({
            file: t.File(),
            name: t.Optional(t.String({ maxLength: 255 })),
            tags: t.Optional(t.String()),
            metadata: t.Optional(t.String()),
          }),
          detail: { summary: "Upload a new document", tags: ["Documents"] },
        },
      )

      // GET /documents — search / list with pagination
      .get(
        "/",
        ({ query, user, set }) =>
          run(
            set,
            pipe(
              parseSearchParams({
                ...query,
                ownerId: user.role === Role.Admin ? query.ownerId : user.userId,
              }),
              Effect.flatMap((params) => docRepo.searchDocuments(params)),
              Effect.map(({ items, total, page, limit }) =>
                toPaginatedDocumentsDTO(items, total, page, limit),
              ),
            ),
          ),
        {
          query: t.Object({
            name: t.Optional(t.String()),
            contentType: t.Optional(t.String()),
            tags: t.Optional(t.String()),
            metadata: t.Optional(t.String()),
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            sortBy: t.Optional(t.String()),
            sortOrder: t.Optional(t.String()),
            ownerId: t.Optional(t.String()),
          }),
          detail: { summary: "Search/list documents", tags: ["Documents"] },
        },
      )

      // GET /documents/:id
      .get(
        "/:id",
        ({ params, user, set }) =>
          run(
            set,
            pipe(
              docRepo.findDocumentById(
                params.id,
                user.role === Role.Admin ? undefined : user.userId,
              ),
              Effect.map((doc) => ({ document: toDocumentDTO(doc) })),
            ),
          ),
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          detail: { summary: "Get a document by ID", tags: ["Documents"] },
        },
      )

      // GET /documents/:id/download — pre-signed URL for the current version
      .get(
        "/:id/download",
        ({ params, user, set }) =>
          run(
            set,
            pipe(
              docRepo.findDocumentById(
                params.id,
                user.role === Role.Admin ? undefined : user.userId,
              ),
              Effect.flatMap((doc) =>
                Option.match(Option.fromNullable(doc.currentVersionId), {
                  onNone: () =>
                    Effect.fail(AppError.notFound("Document has no uploaded version yet")),
                  onSome: (id) => docRepo.findVersionById(id),
                }),
              ),
              Effect.flatMap(presignedDownload),
            ),
          ),
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          detail: {
            summary: "Pre-signed download URL for the current version",
            tags: ["Documents"],
          },
        },
      )

      // POST /documents/:id/versions — upload a new version
      .post(
        "/:id/versions",
        ({ params, body, user, set }) =>
          run(
            set,
            pipe(
              docRepo.findDocumentById(
                params.id,
                user.role === Role.Admin ? undefined : user.userId,
              ),
              Effect.flatMap((doc) =>
                uploadService.uploadNewVersion({
                  doc,
                  file: body.file,
                  name: Option.fromNullable(body.name),
                  actor: user,
                }),
              ),
            ),
          ),
        {
          type: "formdata",
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          body: t.Object({
            file: t.File(),
            name: t.Optional(t.String({ maxLength: 255 })),
          }),
          detail: { summary: "Upload a new version for a document", tags: ["Documents"] },
        },
      )

      // GET /documents/:id/versions
      .get(
        "/:id/versions",
        ({ params, user, set }) =>
          run(
            set,
            pipe(
              docRepo.findDocumentById(
                params.id,
                user.role === Role.Admin ? undefined : user.userId,
              ),
              Effect.flatMap((doc) => docRepo.listVersions(doc.id)),
              Effect.map((versions) => ({ versions: versions.map(toVersionDTO) })),
            ),
          ),
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          detail: { summary: "List all versions of a document", tags: ["Documents"] },
        },
      )

      // GET /documents/:id/versions/:versionId/download
      .get(
        "/:id/versions/:versionId/download",
        ({ params, user, set }) =>
          run(
            set,
            pipe(
              docRepo.findDocumentById(
                params.id,
                user.role === Role.Admin ? undefined : user.userId,
              ),
              Effect.flatMap((doc) =>
                pipe(
                  docRepo.findVersionById(params.versionId),
                  Effect.flatMap((version) =>
                    version.documentId !== doc.id
                      ? Effect.fail(AppError.notFound("version for this document"))
                      : Effect.succeed(version),
                  ),
                ),
              ),
              Effect.flatMap(presignedDownload),
            ),
          ),
        {
          params: t.Object({
            id: t.String({ format: "uuid" }),
            versionId: t.String({ format: "uuid" }),
          }),
          detail: {
            summary: "Pre-signed download URL for a specific version",
            tags: ["Documents"],
          },
        },
      )

      // DELETE /documents/:id — soft delete (admin only)
      .delete(
        "/:id",
        ({ params, user, set }) =>
          run(
            set,
            pipe(
              requireRole(user, Role.Admin),
              Effect.flatMap(() => docRepo.softDeleteDocument(params.id)),
              Effect.tap(() =>
                Effect.sync(() =>
                  eventBus.emit(DocumentEvent.Deleted, {
                    actorId: user.userId,
                    resourceId: params.id,
                  }),
                ),
              ),
              Effect.map(() => ({ message: "Document deleted successfully" })),
            ),
          ),
        {
          params: t.Object({ id: t.String({ format: "uuid" }) }),
          detail: { summary: "Soft-delete a document (admin only)", tags: ["Documents"] },
        },
      )
  );
}
