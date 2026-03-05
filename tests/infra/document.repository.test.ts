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
import { Effect, Either, Option } from "effect";

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
  await Effect.runPromise(userRepo.save(owner));
});

// ---------------------------------------------------------------------------
// findById / findActiveById
// ---------------------------------------------------------------------------

describe("findById", () => {
  it("returns None for unknown document", async () => {
    const id = DocumentId.create(crypto.randomUUID()).unwrap();
    const result = await Effect.runPromise(repo.findById(id));
    expect(Option.isNone(result)).toBe(true);
  });

  it("returns Some after save", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(repo.save(doc));

    const result = await Effect.runPromise(repo.findById(doc.id));
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.id).toBe(doc.id);
    }
  });

  it("returns deleted documents (findById ignores soft-delete)", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(repo.save(doc));

    const deleted = doc.softDelete();
    if (deleted instanceof Error) throw deleted;
    await Effect.runPromise(repo.update(deleted));

    const result = await Effect.runPromise(repo.findById(doc.id));
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.isDeleted).toBe(true);
    }
  });
});

describe("findActiveById", () => {
  it("returns None for soft-deleted document", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(repo.save(doc));

    const deleted = doc.softDelete();
    if (deleted instanceof Error) throw deleted;
    await Effect.runPromise(repo.update(deleted));

    const result = await Effect.runPromise(repo.findActiveById(doc.id));
    expect(Option.isNone(result)).toBe(true);
  });

  it("returns Some for active document", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(repo.save(doc));

    const result = await Effect.runPromise(repo.findActiveById(doc.id));
    expect(Option.isSome(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findByOwner — pagination
// ---------------------------------------------------------------------------

describe("findByOwner", () => {
  it("returns empty page when owner has no documents", async () => {
    const result = await Effect.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(0);
    expect(result.pageInfo.total).toBe(0);
    expect(result.pageInfo.totalPages).toBe(0);
  });

  it("excludes soft-deleted documents", async () => {
    const active = makeDocument({ ownerId: owner.id });
    const toDelete = makeDocument({ ownerId: owner.id });
    await Promise.all([
      Effect.runPromise(repo.save(active)),
      Effect.runPromise(repo.save(toDelete)),
    ]);
    const deleted = toDelete.softDelete();
    if (deleted instanceof Error) throw deleted;
    await Effect.runPromise(repo.update(deleted));

    const result = await Effect.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(active.id);
  });

  it("paginates correctly: page 1 and page 2", async () => {
    // Create 5 documents for this owner
    const docs = Array.from({ length: 5 }, () => makeDocument({ ownerId: owner.id }));
    await Promise.all(docs.map((d) => Effect.runPromise(repo.save(d))));

    const page1 = await Effect.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 3 }));
    const page2 = await Effect.runPromise(repo.findByOwner(owner.id, { page: 2, limit: 3 }));

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
    await Effect.runPromise(userRepo.save(otherOwner));

    const myDoc = makeDocument({ ownerId: owner.id });
    const theirDoc = makeDocument({ ownerId: otherOwner.id });
    await Promise.all([
      Effect.runPromise(repo.save(myDoc)),
      Effect.runPromise(repo.save(theirDoc)),
    ]);

    const result = await Effect.runPromise(repo.findByOwner(owner.id, { page: 1, limit: 10 }));
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
    await Promise.all([
      Effect.runPromise(repo.save(report)),
      Effect.runPromise(repo.save(invoice)),
    ]);

    const result = await Effect.runPromise(repo.search("annual", { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.id).toBe(report.id);
  });

  it("excludes soft-deleted documents from search results", async () => {
    const doc = makeDocument({ ownerId: owner.id, name: "Deleted Spec.pdf" });
    await Effect.runPromise(repo.save(doc));
    const deleted = doc.softDelete();
    if (deleted instanceof Error) throw deleted;
    await Effect.runPromise(repo.update(deleted));

    const result = await Effect.runPromise(repo.search("Deleted", { page: 1, limit: 10 }));
    expect(result.items).toHaveLength(0);
  });

  it("returns empty result when no documents match", async () => {
    const result = await Effect.runPromise(repo.search("nonexistent-xyz", { page: 1, limit: 10 }));
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
    await Effect.runPromise(repo.save(doc));

    const found = await Effect.runPromise(repo.findById(doc.id));
    expect(Option.isSome(found)).toBe(true);
    if (Option.isSome(found)) {
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
    await Effect.runPromise(repo.save(doc));

    const renamed = doc.rename("new-name.pdf");
    if (renamed instanceof Error) throw renamed;
    await Effect.runPromise(repo.update(renamed));

    const found = await Effect.runPromise(repo.findById(doc.id));
    expect(Option.isSome(found)).toBe(true);
    if (Option.isSome(found)) {
      expect(found.value.name).toBe("new-name.pdf");
    }
  });

  it("returns DocumentNotFoundError for nonexistent id", async () => {
    const phantom = makeDocument({ ownerId: owner.id });
    const result = await Effect.runPromise(Effect.either(repo.update(phantom)));

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
    await Effect.runPromise(repo.save(doc));

    const v1 = makeDocumentVersion({ documentId: doc.id, versionNumber: 1, uploadedBy: owner.id });
    const v2 = makeDocumentVersion({ documentId: doc.id, versionNumber: 2, uploadedBy: owner.id });
    const v3 = makeDocumentVersion({ documentId: doc.id, versionNumber: 3, uploadedBy: owner.id });

    // Insert out of order to test sorting
    await Effect.runPromise(repo.saveVersion(v3));
    await Effect.runPromise(repo.saveVersion(v1));
    await Effect.runPromise(repo.saveVersion(v2));

    const versions = await Effect.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(3);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[1]!.versionNumber).toBe(2);
    expect(versions[2]!.versionNumber).toBe(3);
  });

  it("returns empty array for document with no versions", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(repo.save(doc));

    const versions = await Effect.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(0);
  });
});

describe("findVersionById", () => {
  it("returns None for unknown version", async () => {
    const id = VersionId.create(crypto.randomUUID()).unwrap();
    const result = await Effect.runPromise(repo.findVersionById(id));
    expect(Option.isNone(result)).toBe(true);
  });

  it("returns Some after saveVersion", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(repo.save(doc));

    const version = makeDocumentVersion({ documentId: doc.id, uploadedBy: owner.id });
    await Effect.runPromise(repo.saveVersion(version));

    const result = await Effect.runPromise(repo.findVersionById(version.id));
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.id).toBe(version.id);
      expect(result.value.documentId).toBe(doc.id);
    }
  });
});

describe("deleteVersion", () => {
  it("removes version from findVersionsByDocument", async () => {
    const doc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(repo.save(doc));

    const version = makeDocumentVersion({ documentId: doc.id, uploadedBy: owner.id });
    await Effect.runPromise(repo.saveVersion(version));
    await Effect.runPromise(repo.deleteVersion(version.id));

    const versions = await Effect.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(0);
  });

  it("returns DocumentVersionNotFoundError for unknown version id", async () => {
    const id = VersionId.create(crypto.randomUUID()).unwrap();
    const result = await Effect.runPromise(Effect.either(repo.deleteVersion(id)));

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
    await Effect.runPromise(repo.save(doc));

    // 2. Add version 1
    const v1 = makeDocumentVersion({
      documentId: doc.id,
      versionNumber: 1,
      uploadedBy: owner.id,
    });
    await Effect.runPromise(repo.saveVersion(v1));

    // 3. Point document at version 1
    const docWithV1 = doc.setCurrentVersion(v1.id);
    if (docWithV1 instanceof Error) throw docWithV1;
    await Effect.runPromise(repo.update(docWithV1));

    // 4. Add version 2
    const v2 = makeDocumentVersion({
      documentId: doc.id,
      versionNumber: 2,
      uploadedBy: owner.id,
    });
    await Effect.runPromise(repo.saveVersion(v2));

    // 5. Rename + point at version 2
    const docWithV2 = docWithV1.rename("spec-v2.pdf");
    if (docWithV2 instanceof Error) throw docWithV2;
    const docFinal = docWithV2.setCurrentVersion(v2.id);
    if (docFinal instanceof Error) throw docFinal;
    await Effect.runPromise(repo.update(docFinal));

    // 6. Fetch active document
    const activeResult = await Effect.runPromise(repo.findActiveById(doc.id));
    expect(Option.isSome(activeResult)).toBe(true);
    if (Option.isSome(activeResult)) {
      const active = activeResult.value;
      expect(active.name).toBe("spec-v2.pdf");
      expect(Option.isSome(active.currentVersionId)).toBe(true);
      if (Option.isSome(active.currentVersionId)) {
        expect(active.currentVersionId.value).toBe(v2.id);
      }
    }

    // 7. List versions — both present, ascending order
    const versions = await Effect.runPromise(repo.findVersionsByDocument(doc.id));
    expect(versions).toHaveLength(2);
    expect(versions[0]!.versionNumber).toBe(1);
    expect(versions[1]!.versionNumber).toBe(2);

    // 8. Soft-delete and verify findActiveById returns None
    const docDeleted = docFinal.softDelete();
    if (docDeleted instanceof Error) throw docDeleted;
    await Effect.runPromise(repo.update(docDeleted));

    const afterDeleteResult = await Effect.runPromise(repo.findActiveById(doc.id));
    expect(Option.isNone(afterDeleteResult)).toBe(true);

    // findById still returns it (with deletedAt set)
    const byIdResult = await Effect.runPromise(repo.findById(doc.id));
    expect(Option.isSome(byIdResult)).toBe(true);
    if (Option.isSome(byIdResult)) {
      expect(byIdResult.value.isDeleted).toBe(true);
    }
  });
});
