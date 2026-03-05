import { Effect, Option } from "effect";
import { and, eq } from "drizzle-orm";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IAccessPolicyRepository } from "@domain/access-policy/access-policy.repository.ts";
import { AccessPolicyId, DocumentId, UserId } from "@domain/utils/refined.types.ts";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { AccessPolicyRow } from "@infra/database/schema.ts";
import { AccessPolicyNotFoundError } from "@domain/access-policy/access-policy.errors.ts";
import type { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import type { Role } from "@domain/utils/enums.ts";
import { accessPoliciesTable } from "@infra/database/models/access-policy.table.ts";
import { executeQuery, fetchMultiple, fetchSingle } from "@infra/database/utils/query-helpers.ts";

export class DrizzleAccessPolicyRepository implements IAccessPolicyRepository {
  constructor(private readonly db: AppDb) {}

  // -------------------------------------------------------------------------
  // Row ↔ entity
  // -------------------------------------------------------------------------

  private static readonly fromRow = (row: AccessPolicyRow): AccessPolicy => {
    return AccessPolicy.reconstitute(AccessPolicyId.create(row.id).unwrap(), row.createdAt, {
      documentId: DocumentId.create(row.documentId).unwrap(),
      subjectId: row.subjectId ? Option.some(UserId.create(row.subjectId).unwrap()) : Option.none(),
      subjectRole: row.subjectRole ? Option.some(row.subjectRole) : Option.none(),
      action: row.action,
      effect: row.effect,
    });
  };

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  findById(id: AccessPolicyId) {
    return fetchSingle(
      () => this.db.select().from(accessPoliciesTable).where(eq(accessPoliciesTable.id, id)),
      DrizzleAccessPolicyRepository.fromRow,
    );
  }

  findByDocument(documentId: DocumentId) {
    return fetchMultiple(
      () =>
        this.db
          .select()
          .from(accessPoliciesTable)
          .where(eq(accessPoliciesTable.documentId, documentId)),
      DrizzleAccessPolicyRepository.fromRow,
    );
  }

  findByDocumentAndSubject(documentId: DocumentId, userId: UserId) {
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

  findByDocumentAndRole(documentId: DocumentId, role: Role) {
    return fetchMultiple(
      () =>
        this.db
          .select()
          .from(accessPoliciesTable)
          .where(
            and(
              eq(accessPoliciesTable.documentId, documentId),
              eq(accessPoliciesTable.subjectRole, role),
            ),
          ),
      DrizzleAccessPolicyRepository.fromRow,
    );
  }

  findByDocumentSubjectAndAction(documentId: DocumentId, userId: UserId, action: PermissionAction) {
    return fetchMultiple(
      () =>
        this.db
          .select()
          .from(accessPoliciesTable)
          .where(
            and(
              eq(accessPoliciesTable.documentId, documentId),
              eq(accessPoliciesTable.subjectId, userId),
              eq(accessPoliciesTable.action, action),
            ),
          ),
      DrizzleAccessPolicyRepository.fromRow,
    );
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  save(policy: AccessPolicy) {
    return executeQuery(() =>
      this.db.insert(accessPoliciesTable).values({
        id: policy.id,
        documentId: policy.documentId,
        subjectId: Option.getOrNull(policy.subjectId),
        subjectRole: Option.getOrNull(policy.subjectRole),
        action: policy.action,
        effect: policy.effect,
        createdAt: policy.createdAt,
        updatedAt: policy.createdAt,
      }),
    );
  }

  delete(id: AccessPolicyId) {
    return Effect.flatMap(
      executeQuery(() =>
        this.db
          .delete(accessPoliciesTable)
          .where(eq(accessPoliciesTable.id, id))
          .returning({ id: accessPoliciesTable.id }),
      ),
      (rows) => (rows.length > 0 ? Effect.void : Effect.fail(new AccessPolicyNotFoundError(id))),
    );
  }

  deleteByDocument(documentId: DocumentId) {
    return executeQuery(() =>
      this.db.delete(accessPoliciesTable).where(eq(accessPoliciesTable.documentId, documentId)),
    );
  }
}
