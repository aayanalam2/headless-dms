import { Elysia, t } from "elysia";
import { Effect as E, pipe } from "effect";
import { authPlugin } from "../middleware/auth.plugin.ts";
import { run } from "../lib/http.ts";
import type { DocumentWorkflows } from "@application/documents/document.workflows.ts";
import { documentWorkflowToHttp } from "../lib/error-map.ts";

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createDocumentsController(workflows: DocumentWorkflows) {
  return new Elysia({ prefix: "/documents" })
    .use(authPlugin)

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
            E.mapError(documentWorkflowToHttp),
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
            E.mapError(documentWorkflowToHttp),
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

    .get(
      "/:id",
      ({ params, user, set }) =>
        run(
          set,
          pipe(
            workflows.get({ documentId: params.id, actor: user }),
            E.mapError(documentWorkflowToHttp),
          ),
        ),
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        detail: { summary: "Get a document by ID", tags: ["Documents"] },
      },
    )

    .get(
      "/:id/download",
      ({ params, user, set }) =>
        run(
          set,
          pipe(
            workflows.download({ documentId: params.id, actor: user }),
            E.mapError(documentWorkflowToHttp),
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
            E.mapError(documentWorkflowToHttp),
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

    .get(
      "/:id/versions",
      ({ params, user, set }) =>
        run(
          set,
          pipe(
            workflows.listVersions({ documentId: params.id, actor: user }),
            E.mapError(documentWorkflowToHttp),
          ),
        ),
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        detail: { summary: "List all versions of a document", tags: ["Documents"] },
      },
    )

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
            E.mapError(documentWorkflowToHttp),
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

    .delete(
      "/:id",
      ({ params, user, set }) =>
        run(
          set,
          pipe(
            workflows.delete({ documentId: params.id, actor: user }),
            E.mapError(documentWorkflowToHttp),
            E.map(() => ({ message: "Document deleted successfully" })),
          ),
        ),
      {
        params: t.Object({ id: t.String({ format: "uuid" }) }),
        detail: { summary: "Soft-delete a document (admin only)", tags: ["Documents"] },
      },
    );
}
