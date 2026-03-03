import { describe, expect, it } from "bun:test";
import {
  canRead,
  canWrite,
  canDelete,
  buildBucketKey,
  nextVersionNumber,
  validateContentType,
} from "../../src/services/document.service.ts";
import type { JwtClaims } from "../../src/services/auth.service.ts";
import type { DocumentRow } from "../../src/models/db/schema.ts";
import { DocumentId, VersionId } from "../../src/types/branded.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const adminUser: JwtClaims = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.com",
  role: "admin",
};

const ownerUser: JwtClaims = {
  userId: "00000000-0000-4000-8000-000000000002",
  email: "owner@example.com",
  role: "user",
};

const otherUser: JwtClaims = {
  userId: "00000000-0000-4000-8000-000000000003",
  email: "other@example.com",
  role: "user",
};

const now = new Date();

const sampleDoc: DocumentRow = {
  id: "00000000-0000-4000-8000-000000000010",
  ownerId: ownerUser.userId,
  name: "report.pdf",
  contentType: "application/pdf",
  currentVersionId: null,
  tags: ["finance", "q1"],
  metadata: { author: "alice" },
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

// ---------------------------------------------------------------------------
// canRead
// ---------------------------------------------------------------------------

describe("canRead", () => {
  it("allows admin to read any document", () => {
    const result = canRead(adminUser, sampleDoc);
    expect(result.isOk()).toBe(true);
  });

  it("allows the owner to read their own document", () => {
    const result = canRead(ownerUser, sampleDoc);
    expect(result.isOk()).toBe(true);
  });

  it("denies a non-owner user read access", () => {
    const result = canRead(otherUser, sampleDoc);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("AccessDenied");
  });
});

// ---------------------------------------------------------------------------
// canWrite
// ---------------------------------------------------------------------------

describe("canWrite", () => {
  it("allows admin to write any document", () => {
    expect(canWrite(adminUser, sampleDoc).isOk()).toBe(true);
  });

  it("allows the owner to write their own document", () => {
    expect(canWrite(ownerUser, sampleDoc).isOk()).toBe(true);
  });

  it("denies a non-owner user write access", () => {
    const result = canWrite(otherUser, sampleDoc);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("AccessDenied");
  });
});

// ---------------------------------------------------------------------------
// canDelete — admin only
// ---------------------------------------------------------------------------

describe("canDelete", () => {
  it("allows admin to delete", () => {
    expect(canDelete(adminUser).isOk()).toBe(true);
  });

  it("denies owner (non-admin) from deleting", () => {
    const result = canDelete(ownerUser);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("AccessDenied");
  });
});

// ---------------------------------------------------------------------------
// buildBucketKey
// ---------------------------------------------------------------------------

describe("buildBucketKey", () => {
  it("produces a deterministic key in the expected format", () => {
    const docId = DocumentId.create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap();
    const verId = VersionId.create("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").unwrap();
    const key = buildBucketKey(docId, verId, "my report.pdf");

    expect(key).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/my%20report.pdf",
    );
  });

  it("percent-encodes special characters in the filename", () => {
    const docId = DocumentId.create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap();
    const verId = VersionId.create("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb").unwrap();
    const key = buildBucketKey(docId, verId, "hello world & more.pdf");

    expect(key).toContain("hello%20world");
  });
});

// ---------------------------------------------------------------------------
// nextVersionNumber
// ---------------------------------------------------------------------------

describe("nextVersionNumber", () => {
  it("returns 1 when there are no existing versions", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("returns max + 1 for existing versions", () => {
    const versions = [
      { ...sampleDoc, id: "v1", versionNumber: 1, documentId: sampleDoc.id, bucketKey: "k", sizeBytes: 100, uploadedBy: ownerUser.userId, checksum: "abc", createdAt: now },
      { ...sampleDoc, id: "v2", versionNumber: 2, documentId: sampleDoc.id, bucketKey: "k", sizeBytes: 100, uploadedBy: ownerUser.userId, checksum: "def", createdAt: now },
    ];
    expect(nextVersionNumber(versions)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// validateContentType
// ---------------------------------------------------------------------------

describe("validateContentType", () => {
  it("accepts a valid content type", () => {
    const result = validateContentType("application/pdf");
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe("application/pdf");
  });

  it("trims surrounding whitespace", () => {
    const result = validateContentType("  image/png  ");
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe("image/png");
  });

  it("rejects an empty content type", () => {
    const result = validateContentType("");
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().tag).toBe("ValidationError");
  });
});
