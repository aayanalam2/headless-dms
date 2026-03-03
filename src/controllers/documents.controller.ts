import { Elysia, t } from "elysia";
import { Effect, Either, Option, pipe } from "effect";
import { authPlugin, adminPlugin } from "../middleware/auth.plugin.ts";
import {
  findDocumentById,
  searchDocuments,
  softDeleteDocument,
  findVersionById,
  listVersions,
  insertAuditLog,
  listAuditLogs,
} from "../models/document.repository.ts";
import { getPresignedDownloadUrl } from "../models/storage.ts";
import { canRead, canWrite, canDelete } from "../services/document.service.ts";
import { uploadDocument, uploadNewVersion } from "../services/document.upload.service.ts";
import { parseSearchParams } from "../services/search.service.ts";
import { BucketKey } from "../types/branded.ts";
import { toDocumentDTO, toVersionDTO, toPaginatedDocumentsDTO } from "../dto/document.dto.ts";
import { mapErrorToResponse } from "../lib/http.ts";
import { StatusCode } from "status-code-enum";
import { AppError } from "../types/errors.ts";
import { Role, AuditAction, AuditResourceType } from "../types/enums.ts";
import type { VersionRow } from "../models/db/schema.ts";

// ---------------------------------------------------------------------------
// run — execute an Effect pipeline and return the value or set status + body.
// This is the single exit point for every handler.
// ---------------------------------------------------------------------------
async function run<T>(
  set: { status?: number | string | undefined },
  effect: Effect.Effect<T, AppError>,
): Promise<T | ReturnType<typeof mapErrorToResponse>["body"]> {
  const either = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(either)) {
    const mapped = mapErrorToResponse(either.left);
    set.status = mapped.status;
    return mapped.body;
  }
  return either.right;
}

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
// presignedDownload — reusable sub-pipeline for both download routes.
// ---------------------------------------------------------------------------
const presignedDownload = (version: VersionRow) =>
  pipe(
    validateBucketKey(version.bucketKey),
    Effect.flatMap((key) => getPresignedDownloadUrl(key)),
    Effect.map((url) => ({
      url,
      expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
      version: toVersionDTO(version),
    })),
  );

// ---------------------------------------------------------------------------
// Documents controller
// ---------------------------------------------------------------------------

export const documentsController = new Elysia({ prefix: "/documents" })
  .use(authPlugin)

  // POST /documents — upload a new document (first version)
  .post(
    "/",
    ({ body, user, set }) =>
      run(
        set,
        uploadDocument({
          file: body.file,
          name: Option.fromNullable(body.name),
          rawTags: Option.fromNullable(body.tags),
          rawMetadata: Option.fromNullable(body.metadata),
          userId: user.userId,
        }),
      ),
    {
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
          Effect.flatMap((params) => searchDocuments(params)),
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
          findDocumentById(params.id),
          Effect.flatMap((doc) => pipe(canRead(user, doc), Effect.as(doc))),
          Effect.map((doc) => ({ document: toDocumentDTO(doc) })),
        ),
      ),
    {
      params: t.Object({ id: t.String() }),
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
          findDocumentById(params.id),
          Effect.flatMap((doc) => pipe(canRead(user, doc), Effect.as(doc))),
          Effect.flatMap((doc) =>
            Option.match(Option.fromNullable(doc.currentVersionId), {
              onNone: () => Effect.fail(AppError.notFound("Document has no uploaded version yet")),
              onSome: (id) => findVersionById(id),
            }),
          ),
          Effect.flatMap(presignedDownload),
        ),
      ),
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Pre-signed download URL for the current version", tags: ["Documents"] },
    },
  )

  // DELETE /documents/:id — soft delete (admin only)
  .delete(
    "/:id",
    ({ params, user, set }) =>
      run(
        set,
        pipe(
          canDelete(user),
          Effect.flatMap(() => softDeleteDocument(params.id)),
          Effect.tap(() =>
            Effect.ignoreLogged(
              insertAuditLog({
                actorId: user.userId,
                action: AuditAction.DocumentDelete,
                resourceType: AuditResourceType.Document,
                resourceId: params.id,
                metadata: {},
              }),
            ),
          ),
          Effect.map(() => ({ message: "Document deleted successfully" })),
        ),
      ),
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Soft-delete a document (admin only)", tags: ["Documents"] },
    },
  )

  // POST /documents/:id/versions — upload a new version
  .post(
    "/:id/versions",
    ({ params, body, user, set }) =>
      run(
        set,
        pipe(
          findDocumentById(params.id),
          Effect.flatMap((doc) => pipe(canWrite(user, doc), Effect.as(doc))),
          Effect.flatMap((doc) =>
            uploadNewVersion({
              doc,
              file: body.file,
              name: Option.fromNullable(body.name),
              actor: user,
            }),
          ),
        ),
      ),
    {
      params: t.Object({ id: t.String() }),
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
          findDocumentById(params.id),
          Effect.flatMap((doc) => pipe(canRead(user, doc), Effect.as(doc))),
          Effect.flatMap((doc) => listVersions(doc.id)),
          Effect.map((versions) => ({ versions: versions.map(toVersionDTO) })),
        ),
      ),
    {
      params: t.Object({ id: t.String() }),
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
          findDocumentById(params.id),
          Effect.flatMap((doc) => pipe(canRead(user, doc), Effect.as(doc))),
          Effect.flatMap((doc) =>
            pipe(
              findVersionById(params.versionId),
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
      params: t.Object({ id: t.String(), versionId: t.String() }),
      detail: { summary: "Pre-signed download URL for a specific version", tags: ["Documents"] },
    },
  );

// ---------------------------------------------------------------------------
// Audit controller — separate Elysia instance, admin-only
// ---------------------------------------------------------------------------

export const auditController = new Elysia({ prefix: "/audit" }).use(adminPlugin).get(
  "/",
  async ({ query, set }) => {
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;

    if (!Number.isInteger(page) || page < 1) {
      set.status = StatusCode.ClientErrorUnprocessableEntity;
      return { error: "page must be a positive integer" };
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      set.status = StatusCode.ClientErrorUnprocessableEntity;
      return { error: "limit must be between 1 and 100" };
    }

    return run(
      set,
      pipe(
        listAuditLogs({
          page,
          limit,
          resourceType: Option.fromNullable(query.resourceType),
          resourceId: Option.fromNullable(query.resourceId),
        }),
        Effect.map(({ items, total }) => ({
          items,
          pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        })),
      ),
    );
  },
  {
    query: t.Object({
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      resourceType: t.Optional(t.String()),
      resourceId: t.Optional(t.String()),
    }),
    detail: { summary: "List audit logs (admin only)", tags: ["Audit"] },
  },
);
