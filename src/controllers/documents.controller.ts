import { Elysia, t } from "elysia";
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
import type { AppError } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// Shared helper: maps a failed AppResult to an HTTP error response in one line.
// Accepts `set` with an optional status property to match Elysia's context type.
// ---------------------------------------------------------------------------
function fail(
  set: { status?: number | string | undefined },
  err: AppError,
): ReturnType<typeof mapErrorToResponse>["body"] {
  const mapped = mapErrorToResponse(err);
  set.status = mapped.status;
  return mapped.body;
}

// ---------------------------------------------------------------------------
// Documents controller
// ---------------------------------------------------------------------------

export const documentsController = new Elysia({ prefix: "/documents" })
  .use(authPlugin)

  // POST /documents — upload a new document (first version)
  .post(
    "/",
    async ({ body, user, set }) => {
      const result = await uploadDocument({
        file: body.file,
        name: body.name,
        rawTags: body.tags,
        rawMetadata: body.metadata,
        userId: user.userId,
      });
      if (result.isErr()) return fail(set, result.unwrapErr());
      return result.unwrap();
    },
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
    async ({ query, user, set }) => {
      const paramsResult = parseSearchParams({
        ...query,
        ownerId: user.role === "admin" ? query.ownerId : user.userId,
      });
      if (paramsResult.isErr()) return fail(set, paramsResult.unwrapErr());

      const searchResult = await searchDocuments(paramsResult.unwrap());
      if (searchResult.isErr()) return fail(set, searchResult.unwrapErr());

      const { items, total, page, limit } = searchResult.unwrap();
      return toPaginatedDocumentsDTO(items, total, page, limit);
    },
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
    async ({ params, user, set }) => {
      const docResult = await findDocumentById(params.id);
      if (docResult.isErr()) return fail(set, docResult.unwrapErr());

      const doc = docResult.unwrap();
      const accessResult = canRead(user, doc);
      if (accessResult.isErr()) return fail(set, accessResult.unwrapErr());

      return { document: toDocumentDTO(doc) };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get a document by ID", tags: ["Documents"] },
    },
  )

  // GET /documents/:id/download — pre-signed URL for the current version
  .get(
    "/:id/download",
    async ({ params, user, set }) => {
      const docResult = await findDocumentById(params.id);
      if (docResult.isErr()) return fail(set, docResult.unwrapErr());

      const doc = docResult.unwrap();
      const accessResult = canRead(user, doc);
      if (accessResult.isErr()) return fail(set, accessResult.unwrapErr());

      if (!doc.currentVersionId) {
        set.status = 404;
        return { error: "Document has no uploaded version yet" };
      }

      const versionResult = await findVersionById(doc.currentVersionId);
      if (versionResult.isErr()) return fail(set, versionResult.unwrapErr());

      return buildDownloadResponse(set, versionResult.unwrap());
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Pre-signed download URL for the current version", tags: ["Documents"] },
    },
  )

  // DELETE /documents/:id — soft delete (admin only)
  .delete(
    "/:id",
    async ({ params, user, set }) => {
      const accessResult = canDelete(user);
      if (accessResult.isErr()) return fail(set, accessResult.unwrapErr());

      const deleteResult = await softDeleteDocument(params.id);
      if (deleteResult.isErr()) return fail(set, deleteResult.unwrapErr());

      await insertAuditLog({
        actorId: user.userId,
        action: "document.delete",
        resourceType: "document",
        resourceId: params.id,
        metadata: {},
      });

      return { message: "Document deleted successfully" };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Soft-delete a document (admin only)", tags: ["Documents"] },
    },
  )

  // POST /documents/:id/versions — upload a new version
  .post(
    "/:id/versions",
    async ({ params, body, user, set }) => {
      const docResult = await findDocumentById(params.id);
      if (docResult.isErr()) return fail(set, docResult.unwrapErr());

      const doc = docResult.unwrap();
      const writeResult = canWrite(user, doc);
      if (writeResult.isErr()) return fail(set, writeResult.unwrapErr());

      const result = await uploadNewVersion({ doc, file: body.file, name: body.name, actor: user });
      if (result.isErr()) return fail(set, result.unwrapErr());
      return result.unwrap();
    },
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
    async ({ params, user, set }) => {
      const docResult = await findDocumentById(params.id);
      if (docResult.isErr()) return fail(set, docResult.unwrapErr());

      const doc = docResult.unwrap();
      const accessResult = canRead(user, doc);
      if (accessResult.isErr()) return fail(set, accessResult.unwrapErr());

      const versionsResult = await listVersions(params.id);
      if (versionsResult.isErr()) return fail(set, versionsResult.unwrapErr());

      return { versions: versionsResult.unwrap().map(toVersionDTO) };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "List all versions of a document", tags: ["Documents"] },
    },
  )

  // GET /documents/:id/versions/:versionId/download
  .get(
    "/:id/versions/:versionId/download",
    async ({ params, user, set }) => {
      const docResult = await findDocumentById(params.id);
      if (docResult.isErr()) return fail(set, docResult.unwrapErr());

      const doc = docResult.unwrap();
      const accessResult = canRead(user, doc);
      if (accessResult.isErr()) return fail(set, accessResult.unwrapErr());

      const versionResult = await findVersionById(params.versionId);
      if (versionResult.isErr()) return fail(set, versionResult.unwrapErr());

      const version = versionResult.unwrap();
      if (version.documentId !== params.id) {
        set.status = 404;
        return { error: "Version not found for this document" };
      }

      return buildDownloadResponse(set, version);
    },
    {
      params: t.Object({ id: t.String(), versionId: t.String() }),
      detail: { summary: "Pre-signed download URL for a specific version", tags: ["Documents"] },
    },
  );

// ---------------------------------------------------------------------------
// Shared helper: resolve a BucketKey and return a pre-signed download response.
// Extracted because the identical flow appears in two handlers above.
// ---------------------------------------------------------------------------
async function buildDownloadResponse(
  set: { status?: number | string | undefined },
  version: { bucketKey: string; id: string; documentId: string; versionNumber: number; sizeBytes: number; uploadedBy: string; checksum: string; createdAt: Date },
) {
  const keyResult = BucketKey.create(version.bucketKey);
  if (keyResult.isErr()) {
    set.status = 500;
    return { error: "Invalid stored bucket key" };
  }

  const urlResult = await getPresignedDownloadUrl(keyResult.unwrap());
  if (urlResult.isErr()) {
    const mapped = mapErrorToResponse(urlResult.unwrapErr());
    set.status = mapped.status;
    return mapped.body;
  }

  return {
    url: urlResult.unwrap(),
    expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
    version: toVersionDTO(version),
  };
}

// ---------------------------------------------------------------------------
// Audit controller — separate Elysia instance, admin-only
// ---------------------------------------------------------------------------

export const auditController = new Elysia({ prefix: "/audit" })
  .use(adminPlugin)
  .get(
    "/",
    async ({ query, set }) => {
      const page = query.page ? parseInt(query.page, 10) : 1;
      const limit = query.limit ? parseInt(query.limit, 10) : 20;

      if (!Number.isInteger(page) || page < 1) {
        set.status = 422;
        return { error: "page must be a positive integer" };
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        set.status = 422;
        return { error: "limit must be between 1 and 100" };
      }

      const result = await listAuditLogs({
        page,
        limit,
        resourceType: query.resourceType,
        resourceId: query.resourceId,
      });
      if (result.isErr()) return fail(set, result.unwrapErr());

      const { items, total } = result.unwrap();
      return { items, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
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
