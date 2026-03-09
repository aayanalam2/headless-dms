import { Effect as E, Option as O } from "effect";
import { and, eq } from "drizzle-orm";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyRow } from "@infra/database/schema.ts";
import { AccessPolicyNotFoundError } from "@domain/access-policy/access-policy.errors.ts";
import { accessPoliciesTable } from "@infra/database/models/access-policy.table.ts";
import { executeQuery, fetchMultiple, fetchSingle } from "@infra/database/utils/query-helpers.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

export class DrizzleAccessPolicyRepository implements IAccessPolicyRepository {
  constructor(private readonly db: AppDb) {}

  private static readonly fromRow = (row: AccessPolicyRow): AccessPolicy => {
    return AccessPolicy.reconstitute({
      id: AccessPolicyId.create(row.id).unwrap(),
      documentId: DocumentId.create(row.documentId).unwrap(),
      subjectId: UserId.create(row.subjectId).unwrap(),
      action: row.action,
      effect: row.effect,
      createdAt: row.createdAt,
    });
  };

  findById(id: AccessPolicyId): RepositoryEffect<O.Option<AccessPolicy>> {
    return fetchSingle(
      () => this.db.select().from(accessPoliciesTable).where(eq(accessPoliciesTable.id, id)),
      DrizzleAccessPolicyRepository.fromRow,
    );
  }

  findByDocument(documentId: DocumentId): RepositoryEffect<readonly AccessPolicy[]> {
    return fetchMultiple(
      () =>
        this.db
          .select()
          .from(accessPoliciesTable)
          .where(eq(accessPoliciesTable.documentId, documentId)),
      DrizzleAccessPolicyRepository.fromRow,
    );
  }

  findByDocumentAndSubject(
    documentId: DocumentId,
    userId: UserId,
  ): RepositoryEffect<readonly AccessPolicy[]> {
    return fetchMultiple(
      () =>
        this.db
          .select()
          .from(accessPoliciesTable)
          .where(
            and(
              eq(accessPoliciesTable.documentId, documentId),
              eq(accessPoliciesTable.subjectId, userId),
            ),
          ),
      DrizzleAccessPolicyRepository.fromRow,
    );
  }

  save(policy: AccessPolicy): RepositoryEffect<void> {
    return executeQuery(() =>
      this.db.insert(accessPoliciesTable).values({
        id: policy.id,
        documentId: policy.documentId,
        subjectId: policy.subjectId,
        action: policy.action,
        effect: policy.effect,
        createdAt: policy.createdAt,
        updatedAt: policy.createdAt,
      }),
    );
  }

  delete(id: AccessPolicyId): RepositoryEffect<void, AccessPolicyNotFoundError> {
    return E.flatMap(
      executeQuery(() =>
        this.db
          .delete(accessPoliciesTable)
          .where(eq(accessPoliciesTable.id, id))
          .returning({ id: accessPoliciesTable.id }),
      ),
      (rows) => (rows.length > 0 ? E.void : E.fail(new AccessPolicyNotFoundError(id))),
    );
  }

  deleteByDocument(documentId: DocumentId): RepositoryEffect<void> {
    return executeQuery(() =>
      this.db.delete(accessPoliciesTable).where(eq(accessPoliciesTable.documentId, documentId)),
    );
  }
}
