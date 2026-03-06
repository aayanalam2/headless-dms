import { Effect as E, Option as O } from "effect";
import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { BucketKey, Checksum, DocumentId, UserId, VersionId } from "@domain/utils/refined.types.ts";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
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
import { executeQuery, fetchMultiple, fetchSingle } from "@infra/database/utils/query-helpers.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

export class DrizzleDocumentRepository implements IDocumentRepository {
  constructor(private readonly db: AppDb) {}

  private static readonly fromDocumentRow = (row: DocumentRow): Document => {
    return Document.reconstitute({
      id: DocumentId.create(row.id).unwrap(),
      ownerId: UserId.create(row.ownerId).unwrap(),
      name: row.name,
      contentType: row.contentType as ContentType,
      currentVersionId: O.map(O.fromNullable(row.currentVersionId), (v) =>
        VersionId.create(v).unwrap(),
      ),
      tags: row.tags,
      metadata: row.metadata ?? {},
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: O.fromNullable(row.deletedAt),
    });
  };

  private static readonly fromVersionRow = (row: VersionRow): DocumentVersion => {
    return DocumentVersion.reconstitute({
      id: VersionId.create(row.id).unwrap(),
      documentId: DocumentId.create(row.documentId).unwrap(),
      versionNumber: row.versionNumber,
      bucketKey: BucketKey.create(row.bucketKey).unwrap(),
      sizeBytes: row.sizeBytes,
      checksum: Checksum.create(row.checksum).unwrap(),
      uploadedBy: UserId.create(row.uploadedBy).unwrap(),
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

  save(document: Document): RepositoryEffect<void> {
    return executeQuery(() =>
      this.db.insert(documentsTable).values({
        id: document.id,
        ownerId: document.ownerId,
        name: document.name,
        contentType: document.contentType,
        currentVersionId: O.getOrNull(document.currentVersionId),
        tags: [...document.tags],
        metadata: document.metadata,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        deletedAt: O.getOrNull(document.deletedAt),
      }),
    );
  }

  update(document: Document): RepositoryEffect<void, DocumentNotFoundError> {
    return E.flatMap(
      executeQuery(() =>
        this.db
          .update(documentsTable)
          .set({
            name: document.name,
            currentVersionId: O.getOrNull(document.currentVersionId),
            tags: [...document.tags],
            metadata: document.metadata,
            deletedAt: O.getOrNull(document.deletedAt),
            updatedAt: document.updatedAt,
          })
          .where(eq(documentsTable.id, document.id))
          .returning({ id: documentsTable.id }),
      ),
      (rows) => (rows.length > 0 ? E.void : E.fail(new DocumentNotFoundError(document.id))),
    );
  }

  saveVersion(version: DocumentVersion): RepositoryEffect<void> {
    return executeQuery(() =>
      this.db.insert(documentVersionsTable).values({
        id: version.id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        bucketKey: version.bucketKey,
        sizeBytes: version.sizeBytes,
        checksum: version.checksum,
        uploadedBy: version.uploadedBy,
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
      }),
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
}
