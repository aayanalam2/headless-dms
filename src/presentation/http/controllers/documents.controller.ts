import { Elysia, t } from "elysia";
import { Effect, pipe } from "effect";
import { authPlugin } from "../middleware/auth.plugin.ts";
import { run, assertNever } from "../lib/http.ts";
import { AppError } from "@infra/errors.ts";
import {
  DocumentWorkflowErrorTag,
  type DocumentWorkflowError,
} from "@application/documents/document-workflow.errors.ts";
import type { DocumentWorkflows } from "@application/documents/document.workflows.ts";

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
export function createDocumentsController(workflows: DocumentWorkflows) {
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
              workflows.upload(
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
              workflows.list({
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
              workflows.get({ documentId: params.id, actor: user }),
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
              workflows.download({ documentId: params.id, actor: user }),
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
              workflows.uploadVersion(
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
              workflows.listVersions({ documentId: params.id, actor: user }),
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
              workflows.downloadVersion({
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
              workflows.delete({ documentId: params.id, actor: user }),
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
