/**
 * document.repository.test.ts — integration tests for DrizzleDocumentRepository.
 *
 * Tests cover:
 *   • findById / findActiveById
 *   • findByOwner with pagination
 *   • search (name ILIKE)
 *   • save / update
 *   • saveVersion / findVersionsByDocument / findVersionById
 *   • deleteVersion
 *   • E2E round-trip: create → add versions → update → list
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
// findById / findActiveById
// ---------------------------------------------------------------------------

describe("findById", () => {
  it("returns None for unknown document", async () => {
    const id = DocumentId.create(crypto.randomUUID()).unwrap();
    const result = await E.runPromise(repo.findById(id));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns Some after save", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const result = await E.runPromise(repo.findById(doc.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.id).toBe(doc.id);
    }
  });

  it("returns deleted documents (findById ignores soft-delete)", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const deleted = E.runSync(doc.softDelete());
    await E.runPromise(repo.update(deleted));

    const result = await E.runPromise(repo.findById(doc.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.isDeleted).toBe(true);
    }
  });
});

describe("findActiveById", () => {
  it("returns None for soft-deleted document", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const deleted = E.runSync(doc.softDelete());
    await E.runPromise(repo.update(deleted));

    const result = await E.runPromise(repo.findActiveById(doc.id));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns Some for active document", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const result = await E.runPromise(repo.findActiveById(doc.id));
    expect(O.isSome(result)).toBe(true);
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
    await Promise.all([E.runPromise(repo.save(active)), E.runPromise(repo.save(toDelete))]);
    const deleted = E.runSync(toDelete.softDelete());
    await E.runPromise(repo.update(deleted));

    const result = await E.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(active.id);
  });

  it("paginates correctly: page 1 and page 2", async () => {
    // Create 5 documents for this owner
    const docs = Array.from({ length: 5 }, () => makeDocument({ ownerId: owner.id }));
    await Promise.all(docs.map((d) => E.runPromise(repo.save(d))));

    const page1 = await E.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 3 }));
    const page2 = await E.runPromise(repo.findByOwner(owner.id, { page: 2, limit: 3 }));

    expect(page1.items).toHaveLength(3);
    expect(page2.items).toHaveLength(2);
    expect(page1.pageInfo.total).toBe(5);
    expect(page1.pageInfo.totalPages).toBe(2);
    expect(page2.pageInfo.page).toBe(2);

    // Pages must not overlap
    const p1Ids = new Set(page1.items.map((d) => d.id));
    const p2Ids = page2.items.map((d) => d.id);
    expect(p2Ids.every((id) => !p1Ids.has(id))).toBe(true);
  });

  it("only returns documents belonging to the requested owner", async () => {
    const otherOwner = makeUser();
    await E.runPromise(userRepo.save(otherOwner));

    const myDoc = makeDocument({ ownerId: owner.id });
    const theirDoc = makeDocument({ ownerId: otherOwner.id });
    await Promise.all([E.runPromise(repo.save(myDoc)), E.runPromise(repo.save(theirDoc))]);

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
    await Promise.all([E.runPromise(repo.save(report)), E.runPromise(repo.save(invoice))]);

    const result = await E.runPromise(repo.search("annual", { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(report.id);
  });

  it("excludes soft-deleted documents from search results", async () => {
    const doc = makeDocument({ ownerId: owner.id, name: "Deleted Spec.pdf" });
    await E.runPromise(repo.save(doc));
    const deleted = E.runSync(doc.softDelete());
    await E.runPromise(repo.update(deleted));

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
// save / update
// ---------------------------------------------------------------------------

describe("save", () => {
  it("persists all document scalar fields", async () => {
    const doc = makeDocument({
      ownerId: owner.id,
      name: "contract.pdf",
      contentType: "application/pdf",
      tags: ["legal", "signed"],
      metadata: { project: "alpha" },
    });
    await E.runPromise(repo.save(doc));

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
});

describe("update", () => {
  it("persists renamed document", async () => {
    const doc = makeDocument({ ownerId: owner.id, name: "old-name.pdf" });
    await E.runPromise(repo.save(doc));

    const renamed = E.runSync(doc.rename("new-name.pdf"));
    await E.runPromise(repo.update(renamed));

    const found = await E.runPromise(repo.findById(doc.id));
    expect(O.isSome(found)).toBe(true);
    if (O.isSome(found)) {
      expect(found.value.name).toBe("new-name.pdf");
    }
  });

  it("returns DocumentNotFoundError for nonexistent id", async () => {
    const phantom = makeDocument({ ownerId: owner.id });
    const result = await E.runPromise(E.either(repo.update(phantom)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(DocumentNotFoundError);
    }
  });
});

// ---------------------------------------------------------------------------
// versions
// ---------------------------------------------------------------------------

describe("saveVersion / findVersionsByDocument", () => {
  it("returns versions in ascending version-number order", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const v1 = makeDocumentVersion({ documentId: doc.id, versionNumber: 1, uploadedBy: owner.id });
    const v2 = makeDocumentVersion({ documentId: doc.id, versionNumber: 2, uploadedBy: owner.id });
    const v3 = makeDocumentVersion({ documentId: doc.id, versionNumber: 3, uploadedBy: owner.id });

    // Insert out of order to test sorting
    await E.runPromise(repo.saveVersion(v3));
    await E.runPromise(repo.saveVersion(v1));
    await E.runPromise(repo.saveVersion(v2));

    const versions = await E.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(3);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[1]!.versionNumber).toBe(2);
    expect(versions[2]!.versionNumber).toBe(3);
  });

  it("returns empty array for document with no versions", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const versions = await E.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(0);
  });
});

describe("findVersionById", () => {
  it("returns None for unknown version", async () => {
    const id = VersionId.create(crypto.randomUUID()).unwrap();
    const result = await E.runPromise(repo.findVersionById(id));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns Some after saveVersion", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const version = makeDocumentVersion({ documentId: doc.id, uploadedBy: owner.id });
    await E.runPromise(repo.saveVersion(version));

    const result = await E.runPromise(repo.findVersionById(version.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
      expect(result.value.id).toBe(version.id);
      expect(result.value.documentId).toBe(doc.id);
    }
  });
});

describe("deleteVersion", () => {
  it("removes version from findVersionsByDocument", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await E.runPromise(repo.save(doc));

    const version = makeDocumentVersion({ documentId: doc.id, uploadedBy: owner.id });
    await E.runPromise(repo.saveVersion(version));
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
// E2E round-trip: create → add versions → update → list
// ---------------------------------------------------------------------------

describe("E2E round-trip", () => {
  it("create document → add 2 versions → rename → fetch active → list versions", async () => {
    // 1. Create document
    const doc = makeDocument({
      ownerId: owner.id,
      name: "spec-v1.pdf",
      tags: ["spec"],
    });
    await E.runPromise(repo.save(doc));

    // 2. Add version 1
    const v1 = makeDocumentVersion({
      documentId: doc.id,
      versionNumber: 1,
      uploadedBy: owner.id,
    });
    await E.runPromise(repo.saveVersion(v1));

    // 3. Point document at version 1
    const docWithV1 = E.runSync(doc.setCurrentVersion(v1.id));
    await E.runPromise(repo.update(docWithV1));

    // 4. Add version 2
    const v2 = makeDocumentVersion({
      documentId: doc.id,
      versionNumber: 2,
      uploadedBy: owner.id,
    });
    await E.runPromise(repo.saveVersion(v2));

    // 5. Rename + point at version 2
    const docWithV2 = E.runSync(docWithV1.rename("spec-v2.pdf"));
    const docFinal = E.runSync(docWithV2.setCurrentVersion(v2.id));
    await E.runPromise(repo.update(docFinal));

    // 6. Fetch active document
    const activeResult = await E.runPromise(repo.findActiveById(doc.id));
    expect(O.isSome(activeResult)).toBe(true);
    if (O.isSome(activeResult)) {
      const active = activeResult.value;
      expect(active.name).toBe("spec-v2.pdf");
      expect(O.isSome(active.currentVersionId)).toBe(true);
      if (O.isSome(active.currentVersionId)) {
        expect(active.currentVersionId.value).toBe(v2.id);
      }
    }

    // 7. List versions — both present, ascending order
    const versions = await E.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(2);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[1]!.versionNumber).toBe(2);

    // 8. Soft-delete and verify findActiveById returns None
    const docDeleted = E.runSync(docFinal.softDelete());
    await E.runPromise(repo.update(docDeleted));

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
