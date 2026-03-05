import { Elysia, t } from "elysia";
import { Effect, pipe } from "effect";
import { authPlugin } from "../middleware/auth.plugin.ts";
import { run, assertNever } from "../lib/http.ts";
import { AppError } from "@infra/errors.ts";
import {
  AccessPolicyWorkflowErrorTag,
  type AccessPolicyWorkflowError,
} from "@application/access-policy/access-policy-workflow.errors.ts";
import type { AccessPolicyWorkflows } from "@application/access-policy/workflows/access-policy.workflows.ts";
import { PermissionAction, PolicyEffect } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// Error bridge — maps AccessPolicyWorkflowError to the controller-layer AppError.
// ---------------------------------------------------------------------------

function toAppError(e: AccessPolicyWorkflowError): AppError {
  switch (e._tag) {
    case AccessPolicyWorkflowErrorTag.InvalidInput:
      return AppError.validation(e.message);
    case AccessPolicyWorkflowErrorTag.NotFound:
      return AppError.notFound(e.resource);
    case AccessPolicyWorkflowErrorTag.AccessDenied:
      return AppError.accessDenied(e.reason);
    case AccessPolicyWorkflowErrorTag.Conflict:
      return AppError.conflict(e.message);
    case AccessPolicyWorkflowErrorTag.Unavailable:
      return AppError.database(e.operation);
    default:
      return assertNever(e);
  }
}

// ---------------------------------------------------------------------------
// createAccessPolicyController
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function createAccessPolicyController(workflows: AccessPolicyWorkflows) {
  return (
    new Elysia({ prefix: "/access-policies" })
      .use(authPlugin)

      // -----------------------------------------------------------------------
      // POST /access-policies — grant access
      // -----------------------------------------------------------------------
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
                subjectRole: body.subjectRole as Role | undefined,
                action: body.action as PermissionAction,
                effect: body.effect as PolicyEffect,
              }),
              Effect.mapError(toAppError),
            ),
          ),
        {
          body: t.Object({
            documentId: t.String({ format: "uuid" }),
            subjectId: t.Optional(t.String({ format: "uuid" })),
            subjectRole: t.Optional(
              t.Union([t.Literal(Role.Admin), t.Literal(Role.User)]),
            ),
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

      // -----------------------------------------------------------------------
      // GET /access-policies/document/:documentId — list document policies
      // -----------------------------------------------------------------------
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
              Effect.mapError(toAppError),
            ),
          ),
        {
          params: t.Object({ documentId: t.String({ format: "uuid" }) }),
          detail: { summary: "List access policies for a document", tags: ["Access Policies"] },
        },
      )

      // -----------------------------------------------------------------------
      // PATCH /access-policies/:policyId — update access policy effect
      // -----------------------------------------------------------------------
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
              Effect.mapError(toAppError),
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

      // -----------------------------------------------------------------------
      // DELETE /access-policies/:policyId — revoke access
      // -----------------------------------------------------------------------
      .delete(
        "/:policyId",
        ({ params, user, set }) =>
          run(
            set,
            pipe(
              workflows.revokeAccess({ actor: user, policyId: params.policyId }),
              Effect.mapError(toAppError),
            ),
          ),
        {
          params: t.Object({ policyId: t.String({ format: "uuid" }) }),
          detail: { summary: "Revoke an access policy", tags: ["Access Policies"] },
        },
      )

      // -----------------------------------------------------------------------
      // GET /access-policies/check — evaluate access for the requesting user
      // -----------------------------------------------------------------------
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
              Effect.mapError(toAppError),
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
      )
  );
}
