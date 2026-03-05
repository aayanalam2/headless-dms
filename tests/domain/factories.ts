import { Option } from "effect";
import { Document, type CreateDocumentInput } from "@domain/document/document.entity.ts";
import { DocumentVersion, type CreateDocumentVersionInput } from "@domain/document/document-version.entity.ts";
import { InvalidContentTypeError } from "@domain/document/document.errors.ts";
import { User, type CreateUserInput } from "@domain/user/user.entity.ts";
import { AccessPolicy, type CreateAccessPolicyInput } from "@domain/access-policy/access-policy.entity.ts";
import { PolicyTargetRequiredError } from "@domain/access-policy/access-policy.errors.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import {
  AccessPolicyId,
  BucketKey,
  Checksum,
  DocumentId,
  Email,
  HashedPassword,
  UserId,
  VersionId,
} from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";

// ---------------------------------------------------------------------------
// Fixed anchors — use these when the exact value matters for an assertion.
// ---------------------------------------------------------------------------

export const FIXED_DATE = new Date("2025-01-15T10:00:00.000Z");
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

export function makeUser(overrides: Partial<CreateUserInput> = {}): User {
  return User.create({
    id: makeUserId(),
    email: Email.create(`user-${crypto.randomUUID().slice(0, 8)}@example.com`).unwrap(),
    passwordHash: HashedPassword.create(DEFAULT_HASH).unwrap(),
    role: Role.User,
    createdAt: FIXED_DATE,
    ...overrides,
  });
}

export function makeAdminUser(overrides: Partial<CreateUserInput> = {}): User {
  return makeUser({ role: Role.Admin, ...overrides });
}

// ---------------------------------------------------------------------------
// Document factory
// ---------------------------------------------------------------------------

export function makeDocument(
  overrides: Partial<CreateDocumentInput> = {},
): Document {
  const result = Document.create({
    id: makeDocId(),
    ownerId: makeUserId(),
    name: "report.pdf",
    contentType: "application/pdf",
    currentVersionId: null,
    tags: [],
    metadata: {},
    createdAt: FIXED_DATE,
    deletedAt: null,
    ...overrides,
  });
  if (result instanceof InvalidContentTypeError) throw result;
  return result;
}

/** A document already soft-deleted at `FIXED_DATE`. */
export function makeDeletedDocument(overrides: Partial<CreateDocumentInput> = {}): Document {
  const doc = makeDocument(overrides);
  const result = doc.softDelete(FIXED_DATE);
  if (result instanceof Document) return result;
  throw result;
}

// ---------------------------------------------------------------------------
// DocumentVersion factory
// ---------------------------------------------------------------------------

export function makeDocumentVersion(
  overrides: Partial<CreateDocumentVersionInput> = {},
): DocumentVersion {
  const documentId = makeDocId();
  const id = makeVersionId();
  return DocumentVersion.create({
    id,
    documentId,
    versionNumber: 1,
    bucketKey: BucketKey.create(`${documentId}/${id}/report.pdf`).unwrap(),
    sizeBytes: 20_480,
    uploadedBy: makeUserId(),
    checksum: Checksum.create("a".repeat(64)).unwrap(),
    createdAt: FIXED_DATE,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// AccessPolicy factories
// ---------------------------------------------------------------------------

/** Creates a user-specific (subject) policy. */
export function makeSubjectPolicy(
  overrides: Partial<CreateAccessPolicyInput> = {},
): AccessPolicy {
  const result = AccessPolicy.create({
    id: makeAccessPolicyId(),
    documentId: makeDocId(),
    subjectId: makeUserId(),
    subjectRole: null,
    action: PermissionAction.Read,
    effect: PolicyEffect.Allow,
    createdAt: FIXED_DATE,
    ...overrides,
  });
  if (result instanceof PolicyTargetRequiredError) throw result;
  return result;
}

/** Creates a role-based policy. */
export function makeRolePolicy(
  overrides: Partial<CreateAccessPolicyInput> = {},
): AccessPolicy {
  const result = AccessPolicy.create({
    id: makeAccessPolicyId(),
    documentId: makeDocId(),
    subjectId: null,
    subjectRole: Option.some(Role.User),
    action: PermissionAction.Read,
    effect: PolicyEffect.Allow,
    createdAt: FIXED_DATE,
    ...overrides,
  });
  if (result instanceof PolicyTargetRequiredError) throw result;
  return result;
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/**
 * Returns a pre-wired scenario where the user has Allow policies for all
 * four actions on the document, split between subject and role tiers.
 */
export function makeAllowAllScenario(): {
  user: User;
  document: Document;
  allowAllPolicies: AccessPolicy[];
} {
  const user = makeUser();
  const document = makeDocument({ ownerId: user.id });

  const allowAllPolicies = Object.values(PermissionAction).map((action) =>
    makeSubjectPolicy({
      documentId: document.id,
      subjectId: user.id,
      action,
      effect: PolicyEffect.Allow,
    }),
  );

  return { user, document, allowAllPolicies };
}
