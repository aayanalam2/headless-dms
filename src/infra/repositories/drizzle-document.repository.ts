import { Effect as E, Option as O, Schema as S } from "effect";
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { normalizeMaybe, optionToMaybe } from "@domain/utils/utils.ts";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import {
  DocumentId,
  UserId,
  VersionId,
  StringToDocumentId,
  StringToUserId,
  StringToVersionId,
  StringToBucketKey,
  StringToChecksum,
  StringToAccessPolicyId,
} from "@domain/utils/refined.types.ts";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { IAccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import type { DocumentRow, VersionRow } from "@infra/database/schema.ts";
import {
  DocumentNotFoundError,
  DocumentVersionNotFoundError,
} from "@domain/document/document.errors.ts";
import type { Paginated, PaginationParams } from "@domain/utils/pagination.ts";
import { buildPageInfo } from "@domain/utils/pagination.ts";
import type { ContentType } from "@domain/document/value-objects/content-type.vo.ts";
import { documentsTable } from "@infra/database/models/document.table.ts";
import { documentVersionsTable } from "@infra/database/models/document-version.table.ts";
import { accessPoliciesTable } from "@infra/database/models/access-policy.table.ts";
import { PolicyEffect } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import {
  executeQuery,
  executeTransaction,
  fetchMultiple,
  fetchSingle,
} from "@infra/database/utils/query-helpers.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

export class DrizzleDocumentRepository implements IDocumentRepository {
  constructor(private readonly db: AppDb) {}

  private static readonly fromDocumentRow = (row: DocumentRow): Document => {
    return Document.reconstitute({
      id: S.decodeSync(StringToDocumentId)(row.id),
      ownerId: S.decodeSync(StringToUserId)(row.ownerId),
      name: row.name,
      contentType: row.contentType as ContentType,
      currentVersionId: O.map(
        normalizeMaybe(row.currentVersionId),
        S.decodeSync(StringToVersionId),
      ),
      tags: row.tags,
      metadata: row.metadata ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: normalizeMaybe(row.deletedAt),
    });
  };

  private static readonly fromVersionRow = (row: VersionRow): DocumentVersion => {
    return DocumentVersion.reconstitute({
      id: S.decodeSync(StringToVersionId)(row.id),
      documentId: S.decodeSync(StringToDocumentId)(row.documentId),
      versionNumber: row.versionNumber,
      bucketKey: S.decodeSync(StringToBucketKey)(row.bucketKey),
      sizeBytes: row.sizeBytes,
      checksum: S.decodeSync(StringToChecksum)(row.checksum),
      uploadedBy: S.decodeSync(StringToUserId)(row.uploadedBy),
      createdAt: row.createdAt,
    });
  };

  findById(id: DocumentId): RepositoryEffect<O.Option<Document>> {
    return fetchSingle(
      () => this.db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1),
      DrizzleDocumentRepository.fromDocumentRow,
    );
  }

  findActiveById(id: DocumentId): RepositoryEffect<O.Option<Document>> {
    return fetchSingle(
      () =>
        this.db
          .select()
          .from(documentsTable)
          .where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)))
          .limit(1),
      DrizzleDocumentRepository.fromDocumentRow,
    );
  }

  findActiveByIdWithPolicies(
    id: DocumentId,
    subjectId: UserId,
  ): RepositoryEffect<
    O.Option<{ readonly document: Document; readonly policies: readonly IAccessPolicy[] }>
  > {
    return executeQuery(async () => {
      const rows = await this.db
        .select({ doc: documentsTable, policy: accessPoliciesTable })
        .from(documentsTable)
        .leftJoin(
          accessPoliciesTable,
          and(
            eq(accessPoliciesTable.documentId, documentsTable.id),
            eq(accessPoliciesTable.subjectId, subjectId),
          ),
        )
        .where(and(eq(documentsTable.id, id), isNull(documentsTable.deletedAt)));

      if (rows.length === 0) return O.none();

      const document = DrizzleDocumentRepository.fromDocumentRow(rows[0]!.doc);
      const policies: IAccessPolicy[] = rows
        .filter((r) => r.policy !== null)
        .map((r) => {
          const p = r.policy!;
          return {
            id: S.decodeSync(StringToAccessPolicyId)(p.id),
            documentId: S.decodeSync(StringToDocumentId)(p.documentId),
            subjectId: S.decodeSync(StringToUserId)(p.subjectId),
            action: p.action,
            effect: p.effect,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          } satisfies IAccessPolicy;
        });

      return O.some({ document, policies });
    });
  }

  findByOwner(
    ownerId: UserId,
    { page, limit }: PaginationParams,
  ): RepositoryEffect<Paginated<Document>> {
    const offset = (page - 1) * limit;
    const where = and(eq(documentsTable.ownerId, ownerId), isNull(documentsTable.deletedAt));

    return executeQuery(async () => {
      const [countResult, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(documentsTable)
          .where(where),
        this.db
          .select()
          .from(documentsTable)
          .where(where)
          .orderBy(desc(documentsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);
      return {
        items: rows.map(DrizzleDocumentRepository.fromDocumentRow),
        pageInfo: buildPageInfo(countResult[0]?.count ?? 0, page, limit),
      };
    });
  }

  findAccessible(
    subjectId: UserId,
    { page, limit }: PaginationParams,
  ): RepositoryEffect<Paginated<Document>> {
    const offset = (page - 1) * limit;
    const joinCond = and(
      eq(accessPoliciesTable.documentId, documentsTable.id),
      eq(accessPoliciesTable.subjectId, subjectId),
      eq(accessPoliciesTable.effect, PolicyEffect.Allow),
    );
    const where = and(
      isNull(documentsTable.deletedAt),
      or(eq(documentsTable.ownerId, subjectId), isNotNull(accessPoliciesTable.id)),
    );

    return executeQuery(async () => {
      const [countResult, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`cast(count(distinct ${documentsTable.id}) as int)` })
          .from(documentsTable)
          .leftJoin(accessPoliciesTable, joinCond)
          .where(where),
        this.db
          .selectDistinct({ doc: documentsTable })
          .from(documentsTable)
          .leftJoin(accessPoliciesTable, joinCond)
          .where(where)
          .orderBy(desc(documentsTable.createdAt))
          .limit(limit)
          .offset(offset),
      ]);
      return {
        items: rows.map((r) => DrizzleDocumentRepository.fromDocumentRow(r.doc)),
        pageInfo: buildPageInfo(countResult[0]?.count ?? 0, page, limit),
      };
    });
  }

  search(query: string, { page, limit }: PaginationParams): RepositoryEffect<Paginated<Document>> {
    const offset = (page - 1) * limit;
    const where = and(isNull(documentsTable.deletedAt), ilike(documentsTable.name, `%${query}%`));

    return executeQuery(async () => {
      const [countResult, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(documentsTable)
          .where(where),
        this.db
          .select()
          .from(documentsTable)
          .where(where)
          .orderBy(asc(documentsTable.name))
          .limit(limit)
          .offset(offset),
      ]);
      return {
        items: rows.map(DrizzleDocumentRepository.fromDocumentRow),
        pageInfo: buildPageInfo(countResult[0]?.count ?? 0, page, limit),
      };
    });
  }

  findVersionsByDocument(documentId: DocumentId): RepositoryEffect<readonly DocumentVersion[]> {
    return fetchMultiple(
      () =>
        this.db
          .select()
          .from(documentVersionsTable)
          .where(eq(documentVersionsTable.documentId, documentId))
          .orderBy(asc(documentVersionsTable.versionNumber)),
      DrizzleDocumentRepository.fromVersionRow,
    );
  }

  findVersionById(versionId: VersionId): RepositoryEffect<O.Option<DocumentVersion>> {
    return fetchSingle(
      () =>
        this.db
          .select()
          .from(documentVersionsTable)
          .where(eq(documentVersionsTable.id, versionId))
          .limit(1),
      DrizzleDocumentRepository.fromVersionRow,
    );
  }

  softDelete(document: Document): RepositoryEffect<void, DocumentNotFoundError> {
    return E.flatMap(
      executeQuery(() =>
        this.db
          .update(documentsTable)
          .set({
            deletedAt: optionToMaybe(document.deletedAt),
            updatedAt: document.updatedAt,
          })
          .where(eq(documentsTable.id, document.id))
          .returning({ id: documentsTable.id }),
      ),
      (rows) => (rows.length > 0 ? E.void : E.fail(new DocumentNotFoundError(document.id))),
    );
  }

  deleteVersion(versionId: VersionId): RepositoryEffect<void, DocumentVersionNotFoundError> {
    return E.flatMap(
      executeQuery(() =>
        this.db
          .delete(documentVersionsTable)
          .where(eq(documentVersionsTable.id, versionId))
          .returning({ id: documentVersionsTable.id }),
      ),
      (rows) => (rows.length > 0 ? E.void : E.fail(new DocumentVersionNotFoundError(versionId))),
    );
  }

  insertVersionAndUpdate(version: DocumentVersion, updatedDoc: Document): RepositoryEffect<void> {
    return executeTransaction(this.db, async (tx) => {
      await tx.insert(documentVersionsTable).values({
        id: version.id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        bucketKey: version.bucketKey,
        sizeBytes: version.sizeBytes,
        checksum: version.checksum,
        uploadedBy: version.uploadedBy,
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
      });
      await tx
        .update(documentsTable)
        .set({
          name: updatedDoc.name,
          currentVersionId: optionToMaybe(updatedDoc.currentVersionId),
          tags: [...updatedDoc.tags],
          metadata: updatedDoc.metadata,
          deletedAt: optionToMaybe(updatedDoc.deletedAt),
          updatedAt: updatedDoc.updatedAt,
        })
        .where(eq(documentsTable.id, updatedDoc.id));
    });
  }

  insertDocumentWithVersion(
    doc: Document,
    version: DocumentVersion,
    updatedDoc: Document,
  ): RepositoryEffect<void> {
    return executeTransaction(this.db, async (tx) => {
      await tx.insert(documentsTable).values({
        id: doc.id,
        ownerId: doc.ownerId,
        name: doc.name,
        contentType: doc.contentType,
        currentVersionId: optionToMaybe(doc.currentVersionId),
        tags: [...doc.tags],
        metadata: doc.metadata,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        deletedAt: optionToMaybe(doc.deletedAt),
      });
      await tx.insert(documentVersionsTable).values({
        id: version.id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        bucketKey: version.bucketKey,
        sizeBytes: version.sizeBytes,
        checksum: version.checksum,
        uploadedBy: version.uploadedBy,
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
      });
      await tx
        .update(documentsTable)
        .set({
          name: updatedDoc.name,
          currentVersionId: optionToMaybe(updatedDoc.currentVersionId),
          tags: [...updatedDoc.tags],
          metadata: updatedDoc.metadata,
          deletedAt: optionToMaybe(updatedDoc.deletedAt),
          updatedAt: updatedDoc.updatedAt,
        })
        .where(eq(documentsTable.id, updatedDoc.id));
    });
  }
}
