import { Elysia, t } from "elysia";
import { Effect as E, pipe } from "effect";
import { authPlugin } from "../middleware/auth.plugin.ts";
import { run } from "../lib/http.ts";
import type { AccessPolicyWorkflows } from "@application/access-policy/access-policy.workflows.ts";
import { accessPolicyWorkflowToHttp } from "../lib/error-map.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAccessPolicyController(workflows: AccessPolicyWorkflows) {
  return new Elysia({ prefix: "/access-policies" })
    .use(authPlugin)

    .post(
      "/",
      ({ body, user, set }) =>
        run(
          set,
          pipe(
            workflows.grantAccess({
              actor: user,
              documentId: body.documentId,
              subjectId: body.subjectId,
              subjectRole: body.subjectRole,
              action: body.action as PermissionAction,
              effect: body.effect as PolicyEffect,
            }),
            E.mapError(accessPolicyWorkflowToHttp),
          ),
        ),
      {
        body: t.Object({
          documentId: t.String({ format: "uuid" }),
          subjectId: t.Optional(t.String({ format: "uuid" })),
          subjectRole: t.Optional(t.Union([t.Literal(Role.Admin), t.Literal(Role.User)])),
          action: t.Union(
            Object.values(PermissionAction).map((v) => t.Literal(v)) as [
              ReturnType<typeof t.Literal>,
              ...ReturnType<typeof t.Literal>[],
            ],
          ),
          effect: t.Union(
            Object.values(PolicyEffect).map((v) => t.Literal(v)) as [
              ReturnType<typeof t.Literal>,
              ...ReturnType<typeof t.Literal>[],
            ],
          ),
        }),
        detail: { summary: "Grant access to a document", tags: ["Access Policies"] },
      },
    )

    .get(
      "/document/:documentId",
      ({ params, user, set }) =>
        run(
          set,
          pipe(
            workflows.listDocumentPolicies({
              actor: user,
              documentId: params.documentId,
            }),
            E.mapError(accessPolicyWorkflowToHttp),
          ),
        ),
      {
        params: t.Object({ documentId: t.String({ format: "uuid" }) }),
        detail: { summary: "List access policies for a document", tags: ["Access Policies"] },
      },
    )

    .patch(
      "/:policyId",
      ({ params, body, user, set }) =>
        run(
          set,
          pipe(
            workflows.updateAccess({
              actor: user,
              policyId: params.policyId,
              effect: body.effect as PolicyEffect,
            }),
            E.mapError(accessPolicyWorkflowToHttp),
          ),
        ),
      {
        params: t.Object({ policyId: t.String({ format: "uuid" }) }),
        body: t.Object({
          effect: t.Union(
            Object.values(PolicyEffect).map((v) => t.Literal(v)) as [
              ReturnType<typeof t.Literal>,
              ...ReturnType<typeof t.Literal>[],
            ],
          ),
        }),
        detail: { summary: "Update an access policy effect", tags: ["Access Policies"] },
      },
    )

    .delete(
      "/:policyId",
      ({ params, user, set }) =>
        run(
          set,
          pipe(
            workflows.revokeAccess({ actor: user, policyId: params.policyId }),
            E.mapError(accessPolicyWorkflowToHttp),
          ),
        ),
      {
        params: t.Object({ policyId: t.String({ format: "uuid" }) }),
        detail: { summary: "Revoke an access policy", tags: ["Access Policies"] },
      },
    )

    .get(
      "/check",
      ({ query, user, set }) =>
        run(
          set,
          pipe(
            workflows.checkAccess({
              actor: user,
              documentId: query.documentId,
              action: query.action as PermissionAction,
            }),
            E.mapError(accessPolicyWorkflowToHttp),
          ),
        ),
      {
        query: t.Object({
          documentId: t.String({ format: "uuid" }),
          action: t.Union(
            Object.values(PermissionAction).map((v) => t.Literal(v)) as [
              ReturnType<typeof t.Literal>,
              ...ReturnType<typeof t.Literal>[],
            ],
          ),
        }),
        detail: {
          summary: "Check if the requesting user has access to perform an action",
          tags: ["Access Policies"],
        },
      },
    );
}
