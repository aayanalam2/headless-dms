import { Elysia, t } from "elysia";
import { authPlugin } from "../middleware/auth.plugin.ts";
import { makeRun } from "../lib/http.ts";
import type { AccessPolicyWorkflows } from "@application/access-policy/workflows/access-policy.workflows.ts";
import { accessPolicyWorkflowToHttp } from "../lib/error-map.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";

const run = makeRun(accessPolicyWorkflowToHttp);

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAccessPolicyController(workflows: AccessPolicyWorkflows) {
  return new Elysia({ prefix: "/access-policies" })
    .use(authPlugin)

    .post(
      "/",
      ({ body, user, set }) =>
        run(
          set,
          workflows.grantAccess({
            actor: user,
            documentId: body.documentId,
            subjectId: body.subjectId,
            action: body.action as PermissionAction,
            effect: body.effect as PolicyEffect,
          }),
        ),
      {
        body: t.Object({
          documentId: t.String({ format: "uuid" }),
          subjectId: t.String({ format: "uuid" }),
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
          workflows.listDocumentPolicies({
            actor: user,
            documentId: params.documentId,
          }),
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
          workflows.updateAccess({
            actor: user,
            policyId: params.policyId,
            effect: body.effect as PolicyEffect,
          }),
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
        run(set, workflows.revokeAccess({ actor: user, policyId: params.policyId })),
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
          workflows.checkAccess({
            actor: user,
            documentId: query.documentId,
            action: query.action as PermissionAction,
          }),
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
