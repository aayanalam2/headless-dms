import { describe, expect, it } from "bun:test";
import { faker } from "@faker-js/faker";
import {
  canRead,
  canWrite,
  canDelete,
  buildBucketKey,
  nextVersionNumber,
  validateContentType,
} from "../../src/services/document.service.ts";
import { DocumentId, VersionId } from "../../src/types/branded.ts";
import {
  runOk,
  runErr,
  makeDocumentRow,
  makeAdminClaims,
  makeUserClaims,
} from "../helpers/factories.ts";

// ---------------------------------------------------------------------------
// canRead
// ---------------------------------------------------------------------------

describe("canRead", () => {
  it("allows an admin to read any document", () => {
    const admin = makeAdminClaims();
    const doc = makeDocumentRow();
    expect(runOk(canRead(admin, doc))).toBe(true);
  });

  it("allows the document owner to read their own document", () => {
    const user = makeUserClaims();
    const doc = makeDocumentRow({ ownerId: user.userId });
    expect(runOk(canRead(user, doc))).toBe(true);
  });

  it("denies a regular user who does not own the document", () => {
    const user = makeUserClaims();
    const doc = makeDocumentRow({ ownerId: faker.string.uuid() });
    const err = runErr(canRead(user, doc));
    expect(err).toMatchObject({ tag: "AccessDenied" });
  });

  it("denies multiple unrelated users in sequence", () => {
    const doc = makeDocumentRow({ ownerId: faker.string.uuid() });
    for (let i = 0; i < 5; i++) {
      const stranger = makeUserClaims();
      expect(runErr(canRead(stranger, doc))).toMatchObject({ tag: "AccessDenied" });
    }
  });

  it("never denies an admin regardless of document ownership", () => {
    const admin = makeAdminClaims();
    Array.from({ length: 10 }, () => makeDocumentRow()).forEach((doc) =>
      expect(runOk(canRead(admin, doc))).toBe(true),
    );
  });
});

// ---------------------------------------------------------------------------
// canWrite
// ---------------------------------------------------------------------------

describe("canWrite", () => {
  it("allows an admin to write any document", () => {
    const admin = makeAdminClaims();
    expect(runOk(canWrite(admin, makeDocumentRow()))).toBe(true);
  });

  it("allows the document owner to write their own document", () => {
    const user = makeUserClaims();
    expect(runOk(canWrite(user, makeDocumentRow({ ownerId: user.userId })))).toBe(true);
  });

  it("denies a non-owner regular user", () => {
    const user = makeUserClaims();
    const doc = makeDocumentRow({ ownerId: faker.string.uuid() });
    expect(runErr(canWrite(user, doc))).toMatchObject({ tag: "AccessDenied" });
  });

  it("returns an AccessDenied error with a non-empty reason", () => {
    const user = makeUserClaims();
    const doc = makeDocumentRow({ ownerId: faker.string.uuid() });
    const err = runErr(canWrite(user, doc)) as { tag: string; reason: string };
    expect(typeof err.reason).toBe("string");
    expect(err.reason.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// canDelete — admin only
// ---------------------------------------------------------------------------

describe("canDelete", () => {
  it("allows an admin to delete", () => {
    expect(runOk(canDelete(makeAdminClaims()))).toBe(true);
  });

  it("denies a regular user regardless of identity", () => {
    expect(runErr(canDelete(makeUserClaims()))).toMatchObject({ tag: "AccessDenied" });
  });

  it("denies 8 randomly generated regular users", () => {
    for (let i = 0; i < 8; i++) {
      expect(runErr(canDelete(makeUserClaims()))).toMatchObject({ tag: "AccessDenied" });
    }
  });

  it("allows admin with any UUID as userId", () => {
    expect(runOk(canDelete(makeAdminClaims({ userId: faker.string.uuid() })))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildBucketKey
// ---------------------------------------------------------------------------

describe("buildBucketKey", () => {
  function validDocId() {
    return DocumentId.create(faker.string.uuid()).unwrap();
  }
  function validVerId() {
    return VersionId.create(faker.string.uuid()).unwrap();
  }

  it("produces a key in the format {docId}/{verId}/{encodedFilename}", () => {
    const docId = DocumentId.create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap();
    const verId = VersionId.create("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").unwrap();
    expect(buildBucketKey(docId, verId, "my report.pdf")).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/my%20report.pdf",
    );
  });

  it("percent-encodes spaces in arbitrary filenames", () => {
    const key = buildBucketKey(validDocId(), validVerId(), "hello world.pdf");
    expect(key).not.toContain(" ");
  });

  it("encodes special characters: &, #, +, ?", () => {
    const key = buildBucketKey(validDocId(), validVerId(), "hello world & more #1.pdf");
    expect(key).not.toMatch(/[ &#+?]/);
  });

  it("keeps alphanumeric filenames unchanged", () => {
    const docId = validDocId();
    const verId = validVerId();
    const key = buildBucketKey(docId, verId, "plainfilename.pdf");
    expect(key).toEndWith("/plainfilename.pdf");
  });

  it("generates a unique key for each unique versionId", () => {
    const docId = validDocId();
    const keys = Array.from({ length: 5 }, () => buildBucketKey(docId, validVerId(), "file.pdf"));
    expect(new Set(keys).size).toBe(5);
  });

  it("starts with the document ID", () => {
    const docId = validDocId();
    const key = buildBucketKey(docId, validVerId(), "file.txt");
    expect(key.startsWith(String(docId))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nextVersionNumber
// ---------------------------------------------------------------------------

describe("nextVersionNumber", () => {
  function makeVersion(documentId: string, versionNumber: number) {
    return {
      id: faker.string.uuid(),
      documentId,
      versionNumber,
      bucketKey: `k${versionNumber}`,
      sizeBytes: 100,
      uploadedBy: faker.string.uuid(),
      checksum: faker.string.alphanumeric(8),
      createdAt: new Date(),
    };
  }

  it("returns 1 when there are no existing versions", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("returns 2 when the only existing version is number 1", () => {
    const docId = faker.string.uuid();
    expect(nextVersionNumber([makeVersion(docId, 1)])).toBe(2);
  });

  it("returns max + 1 for sequential versions", () => {
    const docId = faker.string.uuid();
    const versions = [1, 2, 3, 4, 5].map((n) => makeVersion(docId, n));
    expect(nextVersionNumber(versions)).toBe(6);
  });

  it("returns max + 1 even when versions are out of order", () => {
    const docId = faker.string.uuid();
    const versions = [3, 1, 5, 2, 4].map((n) => makeVersion(docId, n));
    expect(nextVersionNumber(versions)).toBe(6);
  });

  it("handles non-contiguous version numbers (gaps)", () => {
    const docId = faker.string.uuid();
    const versions = [10, 7, 3].map((n) => makeVersion(docId, n));
    expect(nextVersionNumber(versions)).toBe(11);
  });

  it("is stable across 20 random shuffles of the same list", () => {
    const docId = faker.string.uuid();
    const base = [2, 5, 1, 8, 3].map((n) => makeVersion(docId, n));
    for (let i = 0; i < 20; i++) {
      expect(nextVersionNumber(faker.helpers.shuffle([...base]))).toBe(9);
    }
  });
});

// ---------------------------------------------------------------------------
// validateContentType
// ---------------------------------------------------------------------------

describe("validateContentType", () => {
  it("accepts a valid MIME type", () => {
    expect(runOk(validateContentType("application/pdf"))).toBe("application/pdf");
  });

  it("trims leading and trailing whitespace", () => {
    expect(runOk(validateContentType("  image/png  "))).toBe("image/png");
  });

  it("accepts a variety of real MIME types", () => {
    const types = [
      "text/plain",
      "image/jpeg",
      "image/svg+xml",
      "application/json",
      "application/octet-stream",
      "video/mp4",
    ];
    types.forEach((t) => expect(runOk(validateContentType(t))).toBe(t));
  });

  it("rejects an empty string", () => {
    expect(runErr(validateContentType(""))).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects a string of only whitespace", () => {
    expect(runErr(validateContentType("   "))).toMatchObject({ tag: "ValidationError" });
  });

  it("rejects a tab-only string", () => {
    expect(runErr(validateContentType("\t\t"))).toMatchObject({ tag: "ValidationError" });
  });
});
