import { Effect, Option } from "effect";
import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import {
  BucketKey,
  Checksum,
  DocumentId,
  UserId,
  VersionId,
} from "@domain/utils/refined.types.ts";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import type { DocumentRow, VersionRow } from "@infra/database/schema.ts";
import {
  DocumentNotFoundError,
  DocumentVersionNotFoundError,
} from "@domain/document/document.errors.ts";
import type { PaginationParams } from "@domain/utils/pagination.ts";
import { buildPageInfo } from "@domain/utils/pagination.ts";
import type { ContentType } from "@domain/document/value-objects/content-type.vo.ts";
import { documentsTable } from "@infra/database/models/document.table.ts";
import { documentVersionsTable } from "@infra/database/models/document-version.table.ts";
import {
  executeQuery,
  fetchMultiple,
  fetchSingle,
} from "@infra/database/utils/query-helpers.ts";

export class DrizzleDocumentRepository implements IDocumentRepository {
  constructor(private readonly db: AppDb) {}

  // -------------------------------------------------------------------------
  // Row ↔ entity
  // -------------------------------------------------------------------------

  private static fromDocumentRow(row: DocumentRow): Document {
    return Document.reconstitute(
      DocumentId.create(row.id).unwrap(),
      row.createdAt,
      row.updatedAt,
      {
        ownerId: UserId.create(row.ownerId).unwrap(),
        name: row.name,
        contentType: row.contentType as ContentType,
        currentVersionId: row.currentVersionId
          ? Option.some(VersionId.create(row.currentVersionId).unwrap())
          : Option.none(),
        tags: row.tags,
        metadata: (row.metadata ?? {}),
        deletedAt: row.deletedAt ? Option.some(row.deletedAt) : Option.none(),
      },
    );
  }

  private static fromVersionRow(row: VersionRow): DocumentVersion {
    return DocumentVersion.reconstitute(
      VersionId.create(row.id).unwrap(),
      row.createdAt,
      {
        documentId: DocumentId.create(row.documentId).unwrap(),
        versionNumber: row.versionNumber,
        bucketKey: BucketKey.create(row.bucketKey).unwrap(),
        sizeBytes: row.sizeBytes,
        checksum: Checksum.create(row.checksum).unwrap(),
        uploadedBy: UserId.create(row.uploadedBy).unwrap(),
      },
    );
  }

  // -------------------------------------------------------------------------
  // Document queries
  // -------------------------------------------------------------------------

  findById(id: DocumentId) {
    return fetchSingle(
      () => this.db.select().from(documentsTable).where(eq(documentsTable.id, id)).limit(1),
      DrizzleDocumentRepository.fromDocumentRow,
    );
  }

  findActiveById(id: DocumentId) {
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

  findByOwner(ownerId: UserId, { page, limit }: PaginationParams) {
    const offset = (page - 1) * limit;
    const where = and(eq(documentsTable.ownerId, ownerId), isNull(documentsTable.deletedAt));

    return executeQuery(async () => {
      const [countResult, rows] = await Promise.all([
        this.db.select({ count: sql<number>`cast(count(*) as int)` }).from(documentsTable).where(where),
        this.db.select().from(documentsTable).where(where).orderBy(desc(documentsTable.createdAt)).limit(limit).offset(offset),
      ]);
      return {
        items: rows.map(DrizzleDocumentRepository.fromDocumentRow),
        pageInfo: buildPageInfo(countResult[0]?.count ?? 0, page, limit),
      };
    });
  }

  search(query: string, { page, limit }: PaginationParams) {
    const offset = (page - 1) * limit;
    const where = and(isNull(documentsTable.deletedAt), ilike(documentsTable.name, `%${query}%`));

    return executeQuery(async () => {
      const [countResult, rows] = await Promise.all([
        this.db.select({ count: sql<number>`cast(count(*) as int)` }).from(documentsTable).where(where),
        this.db.select().from(documentsTable).where(where).orderBy(asc(documentsTable.name)).limit(limit).offset(offset),
      ]);
      return {
        items: rows.map(DrizzleDocumentRepository.fromDocumentRow),
        pageInfo: buildPageInfo(countResult[0]?.count ?? 0, page, limit),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Version queries
  // -------------------------------------------------------------------------

  findVersionsByDocument(documentId: DocumentId) {
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

  findVersionById(versionId: VersionId) {
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

  // -------------------------------------------------------------------------
  // Document writes
  // -------------------------------------------------------------------------

  save(document: Document) {
    return executeQuery(() =>
      this.db.insert(documentsTable).values({
        id: document.id,
        ownerId: document.ownerId,
        name: document.name,
        contentType: document.contentType,
        currentVersionId: Option.getOrNull(document.currentVersionId),
        tags: [...document.tags],
        metadata: document.metadata,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
        deletedAt: Option.getOrNull(document.deletedAt),
      }),
    );
  }

  update(document: Document) {
    return Effect.flatMap(
      executeQuery(() =>
        this.db
          .update(documentsTable)
          .set({
            name: document.name,
            currentVersionId: Option.getOrNull(document.currentVersionId),
            tags: [...document.tags],
            metadata: document.metadata,
            deletedAt: Option.getOrNull(document.deletedAt),
            updatedAt: document.updatedAt,
          })
          .where(eq(documentsTable.id, document.id))
          .returning({ id: documentsTable.id }),
      ),
      (rows) =>
        rows.length > 0
          ? Effect.void
          : Effect.fail(new DocumentNotFoundError(document.id)),
    );
  }

  // -------------------------------------------------------------------------
  // Version writes
  // -------------------------------------------------------------------------

  saveVersion(version: DocumentVersion) {
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

  deleteVersion(versionId: VersionId) {
    return Effect.flatMap(
      executeQuery(() =>
        this.db
          .delete(documentVersionsTable)
          .where(eq(documentVersionsTable.id, versionId))
          .returning({ id: documentVersionsTable.id }),
      ),
      (rows) =>
        rows.length > 0
          ? Effect.void
          : Effect.fail(new DocumentVersionNotFoundError(versionId)),
    );
  }
}
