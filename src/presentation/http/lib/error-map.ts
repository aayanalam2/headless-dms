/**
 * error-map.ts — Application workflow errors → HTTP AppError
 *
 * The sole place where workflow errors become AppError values that http.ts
 * turns into HTTP status codes.  One typed function per workflow context.
 *
 * Controllers call E.mapError(<contextWorkflowToHttp>) — no local toAppError
 * functions, no WorkflowErrorTag imports scattered across the presentation layer.
 *
 * Rule (multi-level error guide): each layer translates errors one level up.
 * Controllers translate workflow errors; they must never see domain errors.
 */

import { AppError } from "@infra/errors.ts";
import { assertNever } from "./http.ts";
import {
  UserWorkflowErrorTag,
  type UserWorkflowError,
} from "@application/users/user-workflow.errors.ts";
import {
  DocumentWorkflowErrorTag,
  type DocumentWorkflowError,
} from "@application/documents/document-workflow.errors.ts";
import {
  AccessPolicyWorkflowErrorTag,
  type AccessPolicyWorkflowError,
} from "@application/access-policy/access-policy-workflow.errors.ts";
import {
  AuditWorkflowErrorTag,
  type AuditWorkflowError,
} from "@application/audit/audit-workflow.errors.ts";

export function userWorkflowToHttp(e: UserWorkflowError): AppError {
  switch (e._tag) {
    case UserWorkflowErrorTag.InvalidInput:
      return AppError.validation(e.message);
    case UserWorkflowErrorTag.NotFound:
      return AppError.notFound(e.resource);
    case UserWorkflowErrorTag.Duplicate:
      return AppError.conflict(e.message);
    case UserWorkflowErrorTag.Unauthorized:
      return AppError.accessDenied("Invalid credentials");
    case UserWorkflowErrorTag.Forbidden:
      return AppError.accessDenied(e.reason);
    case UserWorkflowErrorTag.Unavailable:
      return AppError.database(e.operation);
    default:
      return assertNever(e);
  }
}

export function documentWorkflowToHttp(e: DocumentWorkflowError): AppError {
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

export function accessPolicyWorkflowToHttp(e: AccessPolicyWorkflowError): AppError {
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

export function auditWorkflowToHttp(e: AuditWorkflowError): AppError {
  switch (e._tag) {
    case AuditWorkflowErrorTag.InvalidInput:
      return AppError.validation(e.message);
    case AuditWorkflowErrorTag.Unavailable:
      return AppError.database(e.operation);
    default:
      return assertNever(e);
  }
}
