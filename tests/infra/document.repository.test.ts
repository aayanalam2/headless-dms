/**
 * document.repository.test.ts — integration tests for DrizzleDocumentRepository.
 *
 * Tests cover:
 *   • getById / getActiveById
 *   • findByOwner with pagination
 *   • search (name ILIKE)
 *   • insertDocumentWithVersion / softDelete
 *   • insertVersionAndUpdate / findVersionsByDocument / getVersionById
 *   • deleteVersion
 *   • E2E round-trip: create → add versions → soft-delete → list
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { Effect as E, Either, Option as O } from "effect";

import { makeDocument, makeDocumentVersion, makeUser } from "../domain/factories.ts";
import type { TestDb } from "./helpers/db.ts";
import { startTestDb, stopTestDb, truncateAll } from "./helpers/db.ts";
import { DrizzleUserRepository } from "@infra/repositories/drizzle-user.repository.ts";
import { DrizzleDocumentRepository } from "@infra/repositories/drizzle-document.repository.ts";
import {
  DocumentNotFoundError,
  DocumentVersionNotFoundError,
} from "@domain/document/document.errors.ts";
import type { User } from "@domain/user/user.entity.ts";
import type { Document } from "@domain/document/document.entity.ts";
import { DocumentId, VersionId } from "@domain/utils/refined.types.ts";

setDefaultTimeout(60_000);

let db: TestDb;
let userRepo: DrizzleUserRepository;
let repo: DrizzleDocumentRepository;
let owner: User;

beforeAll(async () => {
  db = await startTestDb();
  userRepo = new DrizzleUserRepository(db);
  repo = new DrizzleDocumentRepository(db);
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await truncateAll();
  // Every test needs at least one valid owner to satisfy the FK constraint
  owner = makeUser();
  await E.runPromise(userRepo.save(owner));
});

// ---------------------------------------------------------------------------
// Test helper — inserts a document together with an initial version so FK
// constraints are always satisfied without relying on removed fixture methods.
// Returns the persisted document (with currentVersionId set).
// ---------------------------------------------------------------------------

async function seedDoc(doc: Document, versionNumber = 1): Promise<Document> {
  const version = makeDocumentVersion({
    documentId: doc.id as string,
    versionNumber,
    uploadedBy: owner.id as string,
  });
  const docWithVersion = E.runSync(doc.setCurrentVersion(version.id));
  await E.runPromise(repo.insertDocumentWithVersion(doc, version, docWithVersion));
  return docWithVersion;
}

// ---------------------------------------------------------------------------
// getById / getActiveById
// ---------------------------------------------------------------------------

describe("findById", () => {
  it("returns O.none() for unknown document", async () => {
    const id = DocumentId.create(crypto.randomUUID()).unwrap();
    const result = await E.runPromise(repo.findById(id));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns O.some(document) after insertDocumentWithVersion", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await seedDoc(doc);

    const result = await E.runPromise(repo.findById(doc.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.id).toBe(doc.id);
    }
  });

  it("returns O.some with deleted document (findById ignores soft-delete)", async () => {
    const seeded = await seedDoc(makeDocument({ ownerId: owner.id }));

    const deleted = E.runSync(seeded.softDelete());
    await E.runPromise(repo.softDelete(deleted));

    const result = await E.runPromise(repo.findById(seeded.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.isDeleted).toBe(true);
    }
  });
});

describe("findActiveById", () => {
  it("returns O.none() for soft-deleted document", async () => {
    const seeded = await seedDoc(makeDocument({ ownerId: owner.id }));

    const deleted = E.runSync(seeded.softDelete());
    await E.runPromise(repo.softDelete(deleted));

    const result = await E.runPromise(repo.findActiveById(seeded.id));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns O.some(document) for active document", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await seedDoc(doc);

    const result = await E.runPromise(repo.findActiveById(doc.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.id).toBe(doc.id);
    }
  });
});

// ---------------------------------------------------------------------------
// findByOwner — pagination
// ---------------------------------------------------------------------------

describe("findByOwner", () => {
  it("returns empty page when owner has no documents", async () => {
    const result = await E.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(0);
    expect(result.pageInfo.total).toBe(0);
    expect(result.pageInfo.totalPages).toBe(0);
  });

  it("excludes soft-deleted documents", async () => {
    const active = makeDocument({ ownerId: owner.id });
    const toDelete = makeDocument({ ownerId: owner.id });
    const [, seededToDelete] = await Promise.all([seedDoc(active), seedDoc(toDelete)]);

    const deleted = E.runSync(seededToDelete.softDelete());
    await E.runPromise(repo.softDelete(deleted));

    const result = await E.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(active.id);
  });

  it("paginates correctly: page 1 and page 2", async () => {
    const docs = Array.from({ length: 5 }, () => makeDocument({ ownerId: owner.id }));
    await Promise.all(docs.map((d) => seedDoc(d)));

    const page1 = await E.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 3 }));
    const page2 = await E.runPromise(repo.findByOwner(owner.id, { page: 2, limit: 3 }));

    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(2);
    expect(page1.pageInfo.total).toBe(5);
    expect(page1.pageInfo.totalPages).toBe(2);
    expect(page2.pageInfo.page).toBe(2);

    const p1Ids = new Set(page1.items.map((d) => d.id));
    const p2Ids = page2.items.map((d) => d.id);
    expect(p2Ids.every((id) => !p1Ids.has(id))).toBe(true);
  });

  it("only returns documents belonging to the requested owner", async () => {
    const otherOwner = makeUser();
    await E.runPromise(userRepo.save(otherOwner));

    const myDoc = makeDocument({ ownerId: owner.id });
    const theirDoc = makeDocument({ ownerId: otherOwner.id });
    const myVersion = makeDocumentVersion({
      documentId: myDoc.id as string,
      versionNumber: 1,
      uploadedBy: owner.id as string,
    });
    const myDocWithV = E.runSync(myDoc.setCurrentVersion(myVersion.id));
    const theirVersion = makeDocumentVersion({
      documentId: theirDoc.id as string,
      versionNumber: 1,
      uploadedBy: otherOwner.id as string,
    });
    const theirDocWithV = E.runSync(theirDoc.setCurrentVersion(theirVersion.id));
    await Promise.all([
      E.runPromise(repo.insertDocumentWithVersion(myDoc, myVersion, myDocWithV)),
      E.runPromise(repo.insertDocumentWithVersion(theirDoc, theirVersion, theirDocWithV)),
    ]);

    const result = await E.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(myDoc.id);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("search", () => {
  it("returns matching documents by name substring (case-insensitive)", async () => {
    const report = makeDocument({ ownerId: owner.id, name: "Annual Report 2024.pdf" });
    const invoice = makeDocument({ ownerId: owner.id, name: "Invoice #001.pdf" });
    await Promise.all([seedDoc(report), seedDoc(invoice)]);

    const result = await E.runPromise(repo.search("annual", { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(report.id);
  });

  it("excludes soft-deleted documents from search results", async () => {
    const seeded = await seedDoc(makeDocument({ ownerId: owner.id, name: "Deleted Spec.pdf" }));
    const deleted = E.runSync(seeded.softDelete());
    await E.runPromise(repo.softDelete(deleted));

    const result = await E.runPromise(repo.search("Deleted", { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(0);
  });

  it("returns empty result when no documents match", async () => {
    const result = await E.runPromise(repo.search("nonexistent-xyz", { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(0);
    expect(result.pageInfo.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// insertDocumentWithVersion
// ---------------------------------------------------------------------------

describe("insertDocumentWithVersion", () => {
  it("persists all document scalar fields", async () => {
    const doc = makeDocument({
      ownerId: owner.id,
      name: "contract.pdf",
      contentType: "application/pdf",
      tags: ["legal", "signed"],
      metadata: { project: "alpha" },
    });
    await seedDoc(doc);

    const found = await E.runPromise(repo.findById(doc.id));
    expect(O.isSome(found)).toBe(true);
    if (O.isSome(found)) {
      const d = found.value;
      expect(d.name).toBe("contract.pdf");
      expect(d.contentType).toBe("application/pdf");
      expect(d.tags).toEqual(["legal", "signed"]);
      expect(d.metadata).toEqual({ project: "alpha" });
      expect(d.isDeleted).toBe(false);
    }
  });

  it("sets currentVersionId on the document", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    const version = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 1,
      uploadedBy: owner.id as string,
    });
    const docWithV = E.runSync(doc.setCurrentVersion(version.id));
    await E.runPromise(repo.insertDocumentWithVersion(doc, version, docWithV));

    const optDoc = await E.runPromise(repo.findById(doc.id));
    expect(O.isSome(optDoc)).toBe(true);
    if (O.isSome(optDoc)) {
      const found = optDoc.value;
      expect(O.isSome(found.currentVersionId)).toBe(true);
      if (O.isSome(found.currentVersionId)) {
        expect(found.currentVersionId.value).toBe(version.id);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// softDelete
// ---------------------------------------------------------------------------

describe("softDelete", () => {
  it("marks document as deleted", async () => {
    const seeded = await seedDoc(makeDocument({ ownerId: owner.id }));

    const deleted = E.runSync(seeded.softDelete());
    await E.runPromise(repo.softDelete(deleted));

    const result = await E.runPromise(repo.findById(seeded.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.isDeleted).toBe(true);
    }
  });

  it("returns DocumentNotFoundError for nonexistent id", async () => {
    const phantom = makeDocument({ ownerId: owner.id });
    const phantomDeleted = E.runSync(phantom.softDelete());
    const result = await E.runPromise(E.either(repo.softDelete(phantomDeleted)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DocumentNotFoundError);
    }
  });
});

// ---------------------------------------------------------------------------
// insertVersionAndUpdate / findVersionsByDocument
// ---------------------------------------------------------------------------

describe("insertVersionAndUpdate / findVersionsByDocument", () => {
  it("returns versions in ascending version-number order", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    const seeded = await seedDoc(doc, 1);

    // Add v3 then v2 out of order to test DB-level sorting
    const v3 = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 3,
      uploadedBy: owner.id as string,
    });
    const docV3 = E.runSync(seeded.setCurrentVersion(v3.id));
    await E.runPromise(repo.insertVersionAndUpdate(v3, docV3));

    const v2 = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 2,
      uploadedBy: owner.id as string,
    });
    const docV2 = E.runSync(docV3.setCurrentVersion(v2.id));
    await E.runPromise(repo.insertVersionAndUpdate(v2, docV2));

    const versions = await E.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(3);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[1]!.versionNumber).toBe(2);
    expect(versions[2]!.versionNumber).toBe(3);
  });

  it("updates document fields when inserting a new version", async () => {
    const doc = makeDocument({ ownerId: owner.id, name: "old-name.pdf" });
    const seeded = await seedDoc(doc);

    const v2 = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 2,
      uploadedBy: owner.id as string,
    });
    const renamed = E.runSync(seeded.rename("new-name.pdf"));
    const docV2 = E.runSync(renamed.setCurrentVersion(v2.id));
    await E.runPromise(repo.insertVersionAndUpdate(v2, docV2));

    const found = await E.runPromise(repo.findActiveById(doc.id));
    expect(O.isSome(found)).toBe(true);
    if (O.isSome(found)) {
      expect(found.value.name).toBe("new-name.pdf");
    }
  });

  it("returns all versions for the given document", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    const seeded = await seedDoc(doc, 1);

    const v2 = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 2,
      uploadedBy: owner.id as string,
    });
    await E.runPromise(repo.insertVersionAndUpdate(v2, E.runSync(seeded.setCurrentVersion(v2.id))));

    const versions = await E.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getVersionById
// ---------------------------------------------------------------------------

describe("findVersionById", () => {
  it("returns O.none() for unknown version", async () => {
    const id = VersionId.create(crypto.randomUUID()).unwrap();
    const result = await E.runPromise(repo.findVersionById(id));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns O.some(version) after insertDocumentWithVersion creates it", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    const version = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 1,
      uploadedBy: owner.id as string,
    });
    const docWithV = E.runSync(doc.setCurrentVersion(version.id));
    await E.runPromise(repo.insertDocumentWithVersion(doc, version, docWithV));

    const result = await E.runPromise(repo.findVersionById(version.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.id).toBe(version.id);
      expect(result.value.documentId).toBe(doc.id);
    }
  });
});

// ---------------------------------------------------------------------------
// deleteVersion
// ---------------------------------------------------------------------------

describe("deleteVersion", () => {
  it("removes version from findVersionsByDocument", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    const version = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 1,
      uploadedBy: owner.id as string,
    });
    const docWithV = E.runSync(doc.setCurrentVersion(version.id));
    await E.runPromise(repo.insertDocumentWithVersion(doc, version, docWithV));

    await E.runPromise(repo.deleteVersion(version.id));

    const versions = await E.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(0);
  });

  it("returns DocumentVersionNotFoundError for unknown version id", async () => {
    const id = VersionId.create(crypto.randomUUID()).unwrap();
    const result = await E.runPromise(E.either(repo.deleteVersion(id)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DocumentVersionNotFoundError);
    }
  });
});

// ---------------------------------------------------------------------------
// E2E round-trip: create → add versions → soft-delete → list
// ---------------------------------------------------------------------------

describe("E2E round-trip", () => {
  it("create document → add 2 versions → rename → fetch active → list versions → soft-delete", async () => {
    // 1. Create document with initial version
    const doc = makeDocument({
      ownerId: owner.id,
      name: "spec-v1.pdf",
      tags: ["spec"],
    });
    const v1 = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 1,
      uploadedBy: owner.id as string,
    });
    const docWithV1 = E.runSync(doc.setCurrentVersion(v1.id));
    await E.runPromise(repo.insertDocumentWithVersion(doc, v1, docWithV1));

    // 2. Add version 2 + rename via insertVersionAndUpdate
    const v2 = makeDocumentVersion({
      documentId: doc.id as string,
      versionNumber: 2,
      uploadedBy: owner.id as string,
    });
    const renamed = E.runSync(docWithV1.rename("spec-v2.pdf"));
    const docFinal = E.runSync(renamed.setCurrentVersion(v2.id));
    await E.runPromise(repo.insertVersionAndUpdate(v2, docFinal));

    // 3. Fetch active document — should reflect latest state
    const activeOpt = await E.runPromise(repo.findActiveById(doc.id));
    expect(O.isSome(activeOpt)).toBe(true);
    if (O.isSome(activeOpt)) {
      const active = activeOpt.value;
      expect(active.name).toBe("spec-v2.pdf");
      expect(O.isSome(active.currentVersionId)).toBe(true);
      if (O.isSome(active.currentVersionId)) {
        expect(active.currentVersionId.value).toBe(v2.id);
      }
    }

    // 4. List versions — both present, ascending order
    const versions = await E.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(2);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[1]!.versionNumber).toBe(2);

    // 5. Soft-delete and verify findActiveById returns O.none()
    const docDeleted = E.runSync(docFinal.softDelete());
    await E.runPromise(repo.softDelete(docDeleted));

    const afterDeleteResult = await E.runPromise(repo.findActiveById(doc.id));
    expect(O.isNone(afterDeleteResult)).toBe(true);

    // findById still returns it (with deletedAt set)
    const byIdResult = await E.runPromise(repo.findById(doc.id));
    expect(O.isSome(byIdResult)).toBe(true);
    if (O.isSome(byIdResult)) {
      expect(byIdResult.value.isDeleted).toBe(true);
    }
  });
});
