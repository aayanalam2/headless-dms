import { Effect as E } from "effect";
import { Document, type SerializedDocument } from "@domain/document/document.entity.ts";
import {
  DocumentVersion,
  type SerializedDocumentVersion,
} from "@domain/document/document-version.entity.ts";
import { User, type SerializedUser } from "@domain/user/user.entity.ts";
import {
  AccessPolicy,
  type SerializedAccessPolicy,
} from "@domain/access-policy/access-policy.entity.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { AccessPolicyId, DocumentId, UserId, VersionId } from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// Fixed anchors — use these when the exact value matters for an assertion.
// ---------------------------------------------------------------------------

export const FIXED_DATE = new Date("2025-01-15T10:00:00.000Z");
export const FIXED_ISO = FIXED_DATE.toISOString();
export const FIXED_UUID = "00000000-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Branded-ID helpers
// ---------------------------------------------------------------------------

export const makeDocId = () => DocumentId.create(crypto.randomUUID()).unwrap();
export const makeVersionId = () => VersionId.create(crypto.randomUUID()).unwrap();
export const makeUserId = () => UserId.create(crypto.randomUUID()).unwrap();
export const makeAccessPolicyId = () => AccessPolicyId.create(crypto.randomUUID()).unwrap();

export const fixedDocId = () => DocumentId.create(FIXED_UUID).unwrap();
export const fixedUserId = () => UserId.create(FIXED_UUID).unwrap();

// ---------------------------------------------------------------------------
// User factory
// ---------------------------------------------------------------------------

const DEFAULT_HASH = "$2b$10$hashedpasswordplaceholder1234567890abcdefghijklmnopqrs";

export function makeUser(overrides: Partial<SerializedUser> = {}): User {
  return E.runSync(
    User.create({
      id: makeUserId() as string,
      email: `user-${crypto.randomUUID().slice(0, 8)}@example.com`,
      passwordHash: DEFAULT_HASH,
      role: Role.User,
      createdAt: FIXED_ISO,
      updatedAt: FIXED_ISO,
      ...overrides,
    }),
  );
}

export function makeAdminUser(overrides: Partial<SerializedUser> = {}): User {
  return makeUser({ role: Role.Admin, ...overrides });
}

// ---------------------------------------------------------------------------
// Document factory
// ---------------------------------------------------------------------------

export function makeDocument(overrides: Partial<SerializedDocument> = {}): Document {
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

/** A document already soft-deleted at `FIXED_DATE`. */
export function makeDeletedDocument(overrides: Partial<SerializedDocument> = {}): Document {
  const doc = makeDocument(overrides);
  return E.runSync(doc.softDelete(FIXED_DATE));
}

// ---------------------------------------------------------------------------
// DocumentVersion factory
// ---------------------------------------------------------------------------

export function makeDocumentVersion(
  overrides: Partial<SerializedDocumentVersion> = {},
): DocumentVersion {
  const documentId = makeDocId() as string;
  const id = makeVersionId() as string;
  return E.runSync(
    DocumentVersion.create({
      id,
      documentId,
      versionNumber: 1,
      bucketKey: `${documentId}/${id}/report.pdf`,
      sizeBytes: 20_480,
      uploadedBy: makeUserId() as string,
      checksum: "a".repeat(64),
      createdAt: FIXED_ISO,
      ...overrides,
    }),
  );
}

// ---------------------------------------------------------------------------
// AccessPolicy factories
// ---------------------------------------------------------------------------

/** Creates a user-specific (subject) policy. */
export function makeSubjectPolicy(overrides: Partial<SerializedAccessPolicy> = {}): AccessPolicy {
  return E.runSync(
    AccessPolicy.create({
      id: makeAccessPolicyId() as string,
      documentId: makeDocId() as string,
      subjectId: makeUserId() as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
      createdAt: FIXED_ISO,
      ...overrides,
    }),
  );
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/**
 * Returns a pre-wired scenario where the user has Allow policies for all
 * four actions on the document (all subject-level policies).
 */
export function makeAllowAllScenario(): {
  user: User;
  document: Document;
  allowAllPolicies: AccessPolicy[];
} {
  const user = makeUser();
  const document = makeDocument({ ownerId: user.id as string });

  const allowAllPolicies = Object.values(PermissionAction).map((action) =>
    makeSubjectPolicy({
      documentId: document.id as string,
      subjectId: user.id as string,
      action,
      effect: PolicyEffect.Allow,
    }),
  );

  return { user, document, allowAllPolicies };
}
