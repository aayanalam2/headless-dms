import type { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import type { AccessPolicyNotFoundError } from "@domain/access-policy/access-policy.errors.ts";
import type { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import type { Role } from "@domain/utils/enums.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

export interface IAccessPolicyRepository {
  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  findByDocument(documentId: DocumentId): RepositoryEffect<readonly AccessPolicy[]>;

  /**
   * Load all user-specific (subject) policies for a given user on a document.
   */
  findByDocumentAndSubject(
    documentId: DocumentId,
    userId: UserId,
  ): RepositoryEffect<readonly AccessPolicy[]>;

  /**
   * Load all role-based policies for a given role on a document.
   */
  findByDocumentAndRole(
    documentId: DocumentId,
    role: Role,
  ): RepositoryEffect<readonly AccessPolicy[]>;

  /**
   * Find a specific policy by action for a user on a document.
   */
  findByDocumentSubjectAndAction(
    documentId: DocumentId,
    userId: UserId,
    action: PermissionAction,
  ): RepositoryEffect<readonly AccessPolicy[]>;

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Persist a new access policy (INSERT).
   */
  save(policy: AccessPolicy): RepositoryEffect<void>;

  /**
   * Remove an access policy by its primary key.
   */
  delete(id: AccessPolicyId): RepositoryEffect<void, AccessPolicyNotFoundError>;

  /**
   * Remove all access policies for a document.
   */
  deleteByDocument(documentId: DocumentId): RepositoryEffect<void>;
}
