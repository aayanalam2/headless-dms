import { describe, expect, it } from "bun:test";
import { Effect as E, Either, Option as O } from "effect";
import { Document } from "@domain/document/document.entity.ts";
import { DocumentVersion } from "@domain/document/document-version.entity.ts";
import {
  DocumentAlreadyDeletedError,
  InvalidContentTypeError,
} from "@domain/document/document.errors.ts";
import { hasVersion, isActive, isDeleted, isOwner } from "@domain/document/document.guards.ts";
import { BucketKey, Checksum, DocumentId, UserId, VersionId } from "@domain/utils/refined.types.ts";

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
const FIXED_ISO = FIXED_DATE.toISOString();

/** Build a minimal valid Document for use in tests. */
function makeDocument(overrides: Partial<Parameters<typeof Document.create>[0]> = {}) {
  return E.runSync(
    Document.create({
      id: makeDocId() as string,
      ownerId: makeUserId() as string,
      name: "report.pdf",
      contentType: "application/pdf",
      currentVersionId: null,
      tags: [],
      metadata: {},
      createdAt: FIXED_ISO,
      updatedAt: FIXED_ISO,
      deletedAt: null,
      ...overrides,
    }),
  );
}

// ---------------------------------------------------------------------------
// Document entity
// ---------------------------------------------------------------------------

describe("Document entity", () => {
  describe("Document.create", () => {
    it("creates a document with a valid content type", () => {
      const id = makeDocId();
      const ownerId = makeUserId();
      const result = E.runSync(
        Document.create({
          id: id as string,
          ownerId: ownerId as string,
          name: "spec.pdf",
          contentType: "application/pdf",
          currentVersionId: null,
          tags: ["finance", "q1"],
          metadata: { project: "alpha" },
          createdAt: FIXED_ISO,
          updatedAt: FIXED_ISO,
          deletedAt: null,
        }),
      );

      expect(result).toBeInstanceOf(Document);
      expect(result.id).toBe(id);
      expect(result.ownerId).toBe(ownerId);
      expect(result.name).toBe("spec.pdf");
      expect(result.contentType).toBe("application/pdf");
      expect(O.isNone(result.currentVersionId)).toBe(true);
      expect(result.tags).toEqual(["finance", "q1"]);
      expect(result.metadata).toEqual({ project: "alpha" });
      expect(result.isDeleted).toBe(false);
      expect(O.isNone(result.deletedAt)).toBe(true);
    });

    it("fails with InvalidContentTypeError for a disallowed MIME type", () => {
      const result = E.runSync(
        E.either(
          Document.create({
            id: makeDocId() as string,
            ownerId: makeUserId() as string,
            name: "virus.exe",
            contentType: "application/x-msdownload" as "application/pdf",
            currentVersionId: null,
            tags: [],
            metadata: {},
            createdAt: FIXED_ISO,
            updatedAt: FIXED_ISO,
            deletedAt: null,
          }),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(InvalidContentTypeError);
        expect(result.left.contentType).toBe("application/x-msdownload");
        expect(result.left.message).toContain("application/x-msdownload");
      }
    });

    it("fails with InvalidContentTypeError for an empty string", () => {
      const result = E.runSync(
        E.either(
          Document.create({
            id: makeDocId() as string,
            ownerId: makeUserId() as string,
            name: "empty.bin",
            contentType: "" as "application/pdf",
            currentVersionId: null,
            tags: [],
            metadata: {},
            createdAt: FIXED_ISO,
            updatedAt: FIXED_ISO,
            deletedAt: null,
          }),
        ),
      );

      expect(Either.isLeft(result)).toBe(true);
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
      ] as const;

      for (const contentType of allowed) {
        const result = E.runSync(
          Document.create({
            id: makeDocId() as string,
            ownerId: makeUserId() as string,
            name: "file",
            contentType,
            currentVersionId: null,
            tags: [],
            metadata: {},
            createdAt: FIXED_ISO,
            updatedAt: FIXED_ISO,
            deletedAt: null,
          }),
        );
        expect(result).toBeInstanceOf(Document);
      }
    });
  });

  describe("softDelete", () => {
    it("marks an active document as deleted", () => {
      const doc = makeDocument();
      const now = new Date("2025-06-01T12:00:00.000Z");
      const result = E.runSync(doc.softDelete(now));

      expect(result.isDeleted).toBe(true);
      expect(O.isSome(result.deletedAt)).toBe(true);
      if (O.isSome(result.deletedAt)) {
        expect(result.deletedAt.value).toEqual(now);
      }
      expect(result.updatedAt).toEqual(now);
    });

    it("fails with DocumentAlreadyDeletedError when called on a deleted document", () => {
      const doc = makeDocument();
      const deleted = E.runSync(doc.softDelete());

      const second = E.runSync(E.either(deleted.softDelete()));
      expect(Either.isLeft(second)).toBe(true);
      if (Either.isLeft(second)) {
        expect(second.left).toBeInstanceOf(DocumentAlreadyDeletedError);
      }
    });

    it("does not mutate the original document (immutability)", () => {
      const doc = makeDocument();
      const result = E.runSync(doc.softDelete());

      expect(doc.isDeleted).toBe(false);
      expect(result).not.toBe(doc);
    });
  });

  describe("rename", () => {
    it("returns a new document with the updated name", () => {
      const doc = makeDocument();
      const now = new Date("2025-06-02T08:00:00.000Z");
      const result = E.runSync(doc.rename("renamed.pdf", now));

      expect(result.name).toBe("renamed.pdf");
      expect(result.id).toBe(doc.id);
      expect(result.updatedAt).toEqual(now);
    });

    it("fails with DocumentAlreadyDeletedError when renaming a deleted document", () => {
      const doc = makeDocument();
      const deleted = E.runSync(doc.softDelete());

      const result = E.runSync(E.either(deleted.rename("too-late.pdf")));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(DocumentAlreadyDeletedError);
      }
    });
  });

  describe("setTags", () => {
    it("returns a new document with the new tag list", () => {
      const doc = makeDocument();
      const result = E.runSync(doc.setTags(["legal", "2025"]));

      expect(result.tags).toEqual(["legal", "2025"]);
      expect(doc.tags).toEqual([]); // original unchanged
    });

    it("fails with DocumentAlreadyDeletedError on a deleted document", () => {
      const doc = makeDocument();
      const deleted = E.runSync(doc.softDelete());

      const result = E.runSync(E.either(deleted.setTags(["x"])));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(DocumentAlreadyDeletedError);
      }
    });
  });

  describe("setCurrentVersion", () => {
    it("sets the current version ID", () => {
      const doc = makeDocument();
      const versionId = makeVersionId();
      const result = E.runSync(doc.setCurrentVersion(versionId));

      expect(O.isSome(result.currentVersionId)).toBe(true);
      if (O.isSome(result.currentVersionId)) {
        expect(result.currentVersionId.value).toBe(versionId);
      }
    });

    it("fails with DocumentAlreadyDeletedError on a deleted document", () => {
      const doc = makeDocument();
      const deleted = E.runSync(doc.softDelete());

      const result = E.runSync(E.either(deleted.setCurrentVersion(makeVersionId())));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(DocumentAlreadyDeletedError);
      }
    });
  });

  describe("equals", () => {
    it("two documents with the same id are equal", () => {
      const id = makeDocId();
      const a = makeDocument({ id: id as string });
      const b = makeDocument({ id: id as string });
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
    const bucketKey = BucketKey.create(`${documentId}/${id}/report.pdf`).unwrap();
    const checksum = Checksum.create("a".repeat(64)).unwrap();

    const version = E.runSync(
      DocumentVersion.create({
        id: id as string,
        documentId: documentId as string,
        versionNumber: 1,
        bucketKey: bucketKey as string,
        sizeBytes: 20480,
        checksum: checksum as string,
        uploadedBy: uploadedBy as string,
        createdAt: FIXED_ISO,
      }),
    );

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
    const baseProps = {
      id: id as string,
      documentId: documentId as string,
      versionNumber: 1,
      bucketKey: bucketKey as string,
      sizeBytes: 1024,
      checksum: checksum as string,
      uploadedBy: uploadedBy as string,
      createdAt: FIXED_ISO,
    };

    const v1 = E.runSync(DocumentVersion.create(baseProps));
    const v2 = E.runSync(DocumentVersion.create(baseProps));
    expect(v1.equals(v2)).toBe(true);
  });

  it("two versions with different ids are not equal", () => {
    const documentId = makeDocId();
    const uploadedBy = makeUserId();

    const makeVersion = () => {
      const id = makeVersionId();
      const bucketKey = `${documentId}/${id}/f.pdf`;
      const checksum = "c".repeat(64);
      return E.runSync(
        DocumentVersion.create({
          id: id as string,
          documentId: documentId as string,
          versionNumber: 1,
          bucketKey,
          sizeBytes: 512,
          checksum,
          uploadedBy: uploadedBy as string,
          createdAt: FIXED_ISO,
        }),
      );
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
      const doc = makeDocument({ ownerId: ownerId as string });
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
      const result = E.runSync(doc.softDelete());
      expect(isDeleted(result)).toBe(true);
      expect(isActive(result)).toBe(false);
    });
  });

  describe("hasVersion", () => {
    it("returns false when currentVersionId is none", () => {
      const doc = makeDocument();
      expect(hasVersion(doc)).toBe(false);
    });

    it("returns true after setCurrentVersion", () => {
      const doc = makeDocument();
      const result = E.runSync(doc.setCurrentVersion(makeVersionId()));
      expect(hasVersion(result)).toBe(true);
    });
  });
});
