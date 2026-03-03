import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
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
// Test helpers
// ---------------------------------------------------------------------------

function runOk<T>(effect: Effect.Effect<T, unknown>): T {
  return Effect.runSync(effect);
}

function runErr<E>(effect: Effect.Effect<unknown, E>): E {
  const result = Effect.runSync(Effect.either(effect));
  if (Either.isRight(result)) throw new Error("Expected failure but got success");
  return result.left;
}

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
    expect(runOk(canRead(adminUser, sampleDoc))).toBe(true);
  });

  it("allows the owner to read their own document", () => {
    expect(runOk(canRead(ownerUser, sampleDoc))).toBe(true);
  });

  it("denies a non-owner user read access", () => {
    const err = runErr(canRead(otherUser, sampleDoc));
    expect(err.tag).toBe("AccessDenied");
  });
});

// ---------------------------------------------------------------------------
// canWrite
// ---------------------------------------------------------------------------

describe("canWrite", () => {
  it("allows admin to write any document", () => {
    expect(runOk(canWrite(adminUser, sampleDoc))).toBe(true);
  });

  it("allows the owner to write their own document", () => {
    expect(runOk(canWrite(ownerUser, sampleDoc))).toBe(true);
  });

  it("denies a non-owner user write access", () => {
    const err = runErr(canWrite(otherUser, sampleDoc));
    expect(err.tag).toBe("AccessDenied");
  });
});

// ---------------------------------------------------------------------------
// canDelete — admin only
// ---------------------------------------------------------------------------

describe("canDelete", () => {
  it("allows admin to delete", () => {
    expect(runOk(canDelete(adminUser))).toBe(true);
  });

  it("denies owner (non-admin) from deleting", () => {
    const err = runErr(canDelete(ownerUser));
    expect(err.tag).toBe("AccessDenied");
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
    expect(runOk(validateContentType("application/pdf"))).toBe("application/pdf");
  });

  it("trims surrounding whitespace", () => {
    expect(runOk(validateContentType("  image/png  "))).toBe("image/png");
  });

  it("rejects an empty content type", () => {
    const err = runErr(validateContentType(""));
    expect(err.tag).toBe("ValidationError");
  });
});
