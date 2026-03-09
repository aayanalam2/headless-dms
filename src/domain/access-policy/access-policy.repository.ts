import { type Option as O } from "effect";
import type { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import type { AccessPolicyNotFoundError } from "@domain/access-policy/access-policy.errors.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

export interface IAccessPolicyRepository {
  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  findById(id: AccessPolicyId): RepositoryEffect<O.Option<AccessPolicy>>;

  findByDocument(documentId: DocumentId): RepositoryEffect<readonly AccessPolicy[]>;

  /**
   * Load all user-specific policies for a given user on a document.
   */
  findByDocumentAndSubject(
    documentId: DocumentId,
    userId: UserId,
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
