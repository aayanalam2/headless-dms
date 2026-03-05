import { Elysia, t } from "elysia";
import { Effect, pipe } from "effect";
import { authPlugin } from "../middleware/auth.plugin.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { run, assertNever } from "../lib/http.ts";
import { AppError } from "@infra/errors.ts";
import {
  DocumentWorkflowErrorTag,
  type DocumentWorkflowError,
} from "@application/documents/document-workflow.errors.ts";
import { uploadDocument } from "@application/documents/workflows/upload-document.workflow.ts";
import { uploadVersion } from "@application/documents/workflows/upload-version.workflow.ts";
import { getDocument } from "@application/documents/workflows/get-document.workflow.ts";
import { listDocuments } from "@application/documents/workflows/list-documents.workflow.ts";
import { downloadDocument } from "@application/documents/workflows/download-document.workflow.ts";
import { downloadVersion } from "@application/documents/workflows/download-version.workflow.ts";
import { listVersions } from "@application/documents/workflows/list-versions.workflow.ts";
import { deleteDocument } from "@application/documents/workflows/delete-document.workflow.ts";

// ---------------------------------------------------------------------------
// Error bridge — maps DocumentWorkflowError to the controller-layer AppError.
// ---------------------------------------------------------------------------

function toAppError(e: DocumentWorkflowError): AppError {
  switch (e._tag) {
    case DocumentWorkflowErrorTag.InvalidInput:
      return AppError.validation(e.message);
    case DocumentWorkflowErrorTag.NotFound:
      return AppError.notFound(e.resource);
    case DocumentWorkflowErrorTag.AccessDenied:
      return AppError.accessDenied(e.reason);
    case DocumentWorkflowErrorTag.Conflict:
      return AppError.conflict(e.message);
    case DocumentWorkflowErrorTag.InvalidContentType:
      return AppError.validation(`Unsupported content type: ${e.contentType}`);
    case DocumentWorkflowErrorTag.Unavailable:
      return AppError.database(e.operation);
    default:
      return assertNever(e);
  }
}

// ---------------------------------------------------------------------------
// createDocumentsController
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createDocumentsController(documentRepo: IDocumentRepository, storage: IStorage) {
  const deps = { documentRepo, storage };

  return (
    new Elysia({ prefix: "/documents" })
      .use(authPlugin)

      // POST /documents — upload a new document (first version)
      .post(
        "/",
        ({ body, user, set }) =>
          run(
            set,
            pipe(
              uploadDocument(
                deps,
                { actor: user, name: body.name, rawTags: body.tags, rawMetadata: body.metadata },
                body.file,
              ),
              Effect.mapError(toAppError),
            ),
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
              listDocuments(deps, {
                actor: user,
                name: query.name,
                ownerId: query.ownerId,
                page: query.page,
                limit: query.limit,
              }),
              Effect.mapError(toAppError),
            ),
          ),
        {
          query: t.Object({
            name: t.Optional(t.String()),
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
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
              getDocument(deps, { documentId: params.id, actor: user }),
              Effect.mapError(toAppError),
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
              downloadDocument(deps, { documentId: params.id, actor: user }),
              Effect.mapError(toAppError),
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
              uploadVersion(
                deps,
                { actor: user, documentId: params.id, name: body.name },
                body.file,
              ),
              Effect.mapError(toAppError),
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
              listVersions(deps, { documentId: params.id, actor: user }),
              Effect.mapError(toAppError),
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
              downloadVersion(deps, {
                documentId: params.id,
                versionId: params.versionId,
                actor: user,
              }),
              Effect.mapError(toAppError),
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
              deleteDocument(deps, { documentId: params.id, actor: user }),
              Effect.mapError(toAppError),
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
