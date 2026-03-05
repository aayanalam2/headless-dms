import { describe, expect, it } from "bun:test";
import { Option } from "effect";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import {
  DocumentAlreadyDeletedError,
  InvalidContentTypeError,
} from "@domain/document/document.errors.ts";
import {
  hasVersion,
  isActive,
  isDeleted,
  isOwner,
} from "@domain/document/document.guards.ts";
import {
  BucketKey,
  Checksum,
  DocumentId,
  UserId,
  VersionId,
} from "@domain/utils/refined.types.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDocId() {
  return DocumentId.create(crypto.randomUUID()).unwrap();
}
function makeVersionId() {
  return VersionId.create(crypto.randomUUID()).unwrap();
}
function makeUserId() {
  return UserId.create(crypto.randomUUID()).unwrap();
}

const FIXED_DATE = new Date("2025-01-15T10:00:00.000Z");

/** Build a minimal valid Document for use in tests. */
function makeDocument(overrides: Partial<Parameters<typeof Document.create>[0]> = {}) {
  const ownerId = makeUserId();
  const result = Document.create({
    id: makeDocId(),
    ownerId,
    name: "report.pdf",
    contentType: "application/pdf",
    currentVersionId: Option.none(),
    tags: [],
    metadata: {},
    createdAt: FIXED_DATE,
    deletedAt: Option.none(),
    ...overrides,
  });
  if (result instanceof InvalidContentTypeError) throw result;
  return result;
}

// ---------------------------------------------------------------------------
// Document entity
// ---------------------------------------------------------------------------

describe("Document entity", () => {
  describe("Document.create", () => {
    it("creates a document with a valid content type", () => {
      const id = makeDocId();
      const ownerId = makeUserId();
      const result = Document.create({
        id,
        ownerId,
        name: "spec.pdf",
        contentType: "application/pdf",
        currentVersionId: Option.none(),
        tags: ["finance", "q1"],
        metadata: { project: "alpha" },
        createdAt: FIXED_DATE,
        deletedAt: Option.none(),
      });

      expect(result).toBeInstanceOf(Document);
      if (result instanceof Document) {
        expect(result.id).toBe(id);
        expect(result.ownerId).toBe(ownerId);
        expect(result.name).toBe("spec.pdf");
        expect(result.contentType).toBe("application/pdf");
        expect(Option.isNone(result.currentVersionId)).toBe(true);
        expect(result.tags).toEqual(["finance", "q1"]);
        expect(result.metadata).toEqual({ project: "alpha" });
        expect(result.isDeleted).toBe(false);
        expect(Option.isNone(result.deletedAt)).toBe(true);
      }
    });

    it("returns InvalidContentTypeError for a disallowed MIME type", () => {
      const result = Document.create({
        id: makeDocId(),
        ownerId: makeUserId(),
        name: "virus.exe",
        contentType: "application/x-msdownload",
        currentVersionId: Option.none(),
        tags: [],
        metadata: {},
        createdAt: FIXED_DATE,
        deletedAt: Option.none(),
      });

      expect(result).toBeInstanceOf(InvalidContentTypeError);
      if (result instanceof InvalidContentTypeError) {
        expect(result.contentType).toBe("application/x-msdownload");
        expect(result.message).toContain("application/x-msdownload");
      }
    });

    it("returns InvalidContentTypeError for an empty string", () => {
      const result = Document.create({
        id: makeDocId(),
        ownerId: makeUserId(),
        name: "empty.bin",
        contentType: "",
        currentVersionId: Option.none(),
        tags: [],
        metadata: {},
        createdAt: FIXED_DATE,
        deletedAt: Option.none(),
      });

      expect(result).toBeInstanceOf(InvalidContentTypeError);
    });

    it("accepts all permitted MIME types", () => {
      const allowed = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/csv",
        "image/jpeg",
        "image/png",
      ];

      for (const contentType of allowed) {
        const result = Document.create({
          id: makeDocId(),
          ownerId: makeUserId(),
          name: "file",
          contentType,
          currentVersionId: Option.none(),
          tags: [],
          metadata: {},
          createdAt: FIXED_DATE,
          deletedAt: Option.none(),
        });
        expect(result).toBeInstanceOf(Document);
      }
    });
  });

  describe("softDelete", () => {
    it("marks an active document as deleted", () => {
      const doc = makeDocument();
      const now = new Date("2025-06-01T12:00:00.000Z");
      const result = doc.softDelete(now);

      expect(result).toBeInstanceOf(Document);
      if (result instanceof Document) {
        expect(result.isDeleted).toBe(true);
        expect(Option.isSome(result.deletedAt)).toBe(true);
        if (Option.isSome(result.deletedAt)) {
          expect(result.deletedAt.value).toEqual(now);
        }
        expect(result.updatedAt).toEqual(now);
      }
    });

    it("returns DocumentAlreadyDeletedError when called on a deleted document", () => {
      const doc = makeDocument();
      const deleted = doc.softDelete();
      expect(deleted).toBeInstanceOf(Document);

      if (deleted instanceof Document) {
        const second = deleted.softDelete();
        expect(second).toBeInstanceOf(DocumentAlreadyDeletedError);
      }
    });

    it("does not mutate the original document (immutability)", () => {
      const doc = makeDocument();
      const result = doc.softDelete();

      expect(doc.isDeleted).toBe(false);
      expect(result).not.toBe(doc);
    });
  });

  describe("rename", () => {
    it("returns a new document with the updated name", () => {
      const doc = makeDocument();
      const now = new Date("2025-06-02T08:00:00.000Z");
      const result = doc.rename("renamed.pdf", now);

      expect(result).toBeInstanceOf(Document);
      if (result instanceof Document) {
        expect(result.name).toBe("renamed.pdf");
        expect(result.id).toBe(doc.id);
        expect(result.updatedAt).toEqual(now);
      }
    });

    it("returns DocumentAlreadyDeletedError when renaming a deleted document", () => {
      const doc = makeDocument();
      const deleted = doc.softDelete();
      expect(deleted).toBeInstanceOf(Document);

      if (deleted instanceof Document) {
        const result = deleted.rename("too-late.pdf");
        expect(result).toBeInstanceOf(DocumentAlreadyDeletedError);
      }
    });
  });

  describe("setTags", () => {
    it("returns a new document with the new tag list", () => {
      const doc = makeDocument();
      const result = doc.setTags(["legal", "2025"]);

      expect(result).toBeInstanceOf(Document);
      if (result instanceof Document) {
        expect(result.tags).toEqual(["legal", "2025"]);
        expect(doc.tags).toEqual([]); // original unchanged
      }
    });

    it("returns DocumentAlreadyDeletedError on a deleted document", () => {
      const doc = makeDocument();
      const deleted = doc.softDelete();
      expect(deleted).toBeInstanceOf(Document);

      if (deleted instanceof Document) {
        expect(deleted.setTags(["x"])).toBeInstanceOf(DocumentAlreadyDeletedError);
      }
    });
  });

  describe("setCurrentVersion", () => {
    it("sets the current version ID", () => {
      const doc = makeDocument();
      const versionId = makeVersionId();
      const result = doc.setCurrentVersion(versionId);

      expect(result).toBeInstanceOf(Document);
      if (result instanceof Document) {
        expect(Option.isSome(result.currentVersionId)).toBe(true);
        if (Option.isSome(result.currentVersionId)) {
          expect(result.currentVersionId.value).toBe(versionId);
        }
      }
    });

    it("returns DocumentAlreadyDeletedError on a deleted document", () => {
      const doc = makeDocument();
      const deleted = doc.softDelete();
      expect(deleted).toBeInstanceOf(Document);

      if (deleted instanceof Document) {
        expect(deleted.setCurrentVersion(makeVersionId())).toBeInstanceOf(
          DocumentAlreadyDeletedError,
        );
      }
    });
  });

  describe("equals", () => {
    it("two documents with the same id are equal", () => {
      const id = makeDocId();
      const a = makeDocument({ id });
      const b = makeDocument({ id });
      expect(a.equals(b)).toBe(true);
    });

    it("two documents with different ids are not equal", () => {
      const a = makeDocument();
      const b = makeDocument();
      expect(a.equals(b)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// DocumentVersion entity
// ---------------------------------------------------------------------------

describe("DocumentVersion entity", () => {
  it("creates a version with all props accessible via getters", () => {
    const id = makeVersionId();
    const documentId = makeDocId();
    const uploadedBy = makeUserId();
    const bucketKey = BucketKey.create(
      `${documentId}/${id}/report.pdf`,
    ).unwrap();
    const checksum = Checksum.create("a".repeat(64)).unwrap();

    const version = DocumentVersion.create({
      id,
      documentId,
      versionNumber: 1,
      bucketKey,
      sizeBytes: 20480,
      checksum,
      uploadedBy,
      createdAt: FIXED_DATE,
    });

    expect(version.id).toBe(id);
    expect(version.documentId).toBe(documentId);
    expect(version.versionNumber).toBe(1);
    expect(version.bucketKey).toBe(bucketKey);
    expect(version.sizeBytes).toBe(20480);
    expect(version.checksum).toBe(checksum);
    expect(version.uploadedBy).toBe(uploadedBy);
    expect(version.createdAt).toEqual(FIXED_DATE);
  });

  it("two versions with the same id are equal", () => {
    const id = makeVersionId();
    const documentId = makeDocId();
    const uploadedBy = makeUserId();
    const bucketKey = BucketKey.create(`${documentId}/${id}/f.pdf`).unwrap();
    const checksum = Checksum.create("b".repeat(64)).unwrap();
    const props = {
      id,
      documentId,
      versionNumber: 1,
      bucketKey,
      sizeBytes: 1024,
      checksum,
      uploadedBy,
      createdAt: FIXED_DATE,
    };

    const v1 = DocumentVersion.create(props);
    const v2 = DocumentVersion.create(props);
    expect(v1.equals(v2)).toBe(true);
  });

  it("two versions with different ids are not equal", () => {
    const documentId = makeDocId();
    const uploadedBy = makeUserId();

    const makeVersion = () => {
      const id = makeVersionId();
      const bucketKey = BucketKey.create(`${documentId}/${id}/f.pdf`).unwrap();
      const checksum = Checksum.create("c".repeat(64)).unwrap();
      return DocumentVersion.create({
        id,
        documentId,
        versionNumber: 1,
        bucketKey,
        sizeBytes: 512,
        checksum,
        uploadedBy,
        createdAt: FIXED_DATE,
      });
    };

    expect(makeVersion().equals(makeVersion())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Document guards
// ---------------------------------------------------------------------------

describe("Document guards", () => {
  describe("isOwner", () => {
    it("returns true for the document owner", () => {
      const ownerId = makeUserId();
      const doc = makeDocument({ ownerId });
      expect(isOwner(doc, ownerId)).toBe(true);
    });

    it("returns false for a different user", () => {
      const doc = makeDocument();
      expect(isOwner(doc, makeUserId())).toBe(false);
    });
  });

  describe("isDeleted / isActive", () => {
    it("isActive returns true for a fresh document", () => {
      const doc = makeDocument();
      expect(isActive(doc)).toBe(true);
      expect(isDeleted(doc)).toBe(false);
    });

    it("isDeleted returns true after softDelete", () => {
      const doc = makeDocument();
      const result = doc.softDelete();
      expect(result).toBeInstanceOf(Document);
      if (result instanceof Document) {
        expect(isDeleted(result)).toBe(true);
        expect(isActive(result)).toBe(false);
      }
    });
  });

  describe("hasVersion", () => {
    it("returns false when currentVersionId is none", () => {
      const doc = makeDocument();
      expect(hasVersion(doc)).toBe(false);
    });

    it("returns true after setCurrentVersion", () => {
      const doc = makeDocument();
      const result = doc.setCurrentVersion(makeVersionId());
      expect(result).toBeInstanceOf(Document);
      if (result instanceof Document) {
        expect(hasVersion(result)).toBe(true);
      }
    });
  });
});
