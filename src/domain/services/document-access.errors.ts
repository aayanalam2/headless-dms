import { DomainError } from "@domain/utils/base.errors.ts";
import type { DocumentId, UserId } from "@domain/utils/refined.types.ts";
import type { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";

export enum DocumentAccessErrorTags {
  DocumentAccessDenied = "DocumentAccessDenied",
}

/**
 * Raised by application-layer callers that treat a false result from
 * `DocumentAccessService.evaluate()` as a hard failure.  The domain service
 * itself returns `boolean` — this error is a convenience for call sites that
 * want to short-circuit with a typed error instead of branching on the result.
 */
export class DocumentAccessDeniedError extends DomainError {
  readonly _tag = DocumentAccessErrorTags.DocumentAccessDenied as const;

  constructor(
    readonly userId: UserId,
    readonly documentId: DocumentId,
    readonly action: PermissionAction,
  ) {
    super(`User '${userId}' does not have '${action}' permission on document '${documentId}'`);
  }
}

/** Union of every error that can originate within the document-access domain service. */
export type DocumentAccessDomainError = DocumentAccessDeniedError;
