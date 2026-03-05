/**
 * access-policy.repository.test.ts — integration tests for DrizzleAccessPolicyRepository.
 *
 * Tests cover:
 *   • save subject policy → query by document / by subject / by action
 *   • save role policy → query by document / by role
 *   • delete by id (success + not-found)
 *   • deleteByDocument bulk removal
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { Effect, Either, Option } from "effect";

import { makeDocument, makeRolePolicy, makeSubjectPolicy, makeUser } from "../domain/factories.ts";
import type { TestDb } from "./helpers/db.ts";
import { startTestDb, stopTestDb, truncateAll } from "./helpers/db.ts";
import { DrizzleUserRepository } from "@infra/repositories/drizzle-user.repository.ts";
import { DrizzleDocumentRepository } from "@infra/repositories/drizzle-document.repository.ts";
import { DrizzleAccessPolicyRepository } from "@infra/repositories/drizzle-access-policy.repository.ts";
import { AccessPolicyNotFoundError } from "@domain/access-policy/access-policy.errors.ts";
import { AccessPolicyId } from "@domain/utils/refined.types.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";
import type { User } from "@domain/user/user.entity.ts";
import type { Document } from "@domain/document/document.entity.ts";

setDefaultTimeout(60_000);

let db: TestDb;
let userRepo: DrizzleUserRepository;
let docRepo: DrizzleDocumentRepository;
let repo: DrizzleAccessPolicyRepository;
let owner: User;
let doc: Document;

beforeAll(async () => {
  db = await startTestDb();
  userRepo = new DrizzleUserRepository(db);
  docRepo = new DrizzleDocumentRepository(db);
  repo = new DrizzleAccessPolicyRepository(db);
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await truncateAll();
  // Seed a shared owner + document for every test (FK requirements)
  owner = makeUser();
  await Effect.runPromise(userRepo.save(owner));
  doc = makeDocument({ ownerId: owner.id });
  await Effect.runPromise(docRepo.save(doc));
});

// ---------------------------------------------------------------------------
// findByDocument
// ---------------------------------------------------------------------------

describe("findByDocument", () => {
  it("returns empty array when document has no policies", async () => {
    const policies = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(policies).toHaveLength(0);
  });

  it("returns all policies for a document", async () => {
    const p1 = makeSubjectPolicy({
      documentId: doc.id,
      subjectId: owner.id,
      action: PermissionAction.Read,
    });
    const p2 = makeSubjectPolicy({
      documentId: doc.id,
      subjectId: owner.id,
      action: PermissionAction.Write,
    });
    await Promise.all([Effect.runPromise(repo.save(p1)), Effect.runPromise(repo.save(p2))]);

    const policies = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(policies).toHaveLength(2);
  });

  it("does not return policies for a different document", async () => {
    const otherDoc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(docRepo.save(otherDoc));

    const p = makeSubjectPolicy({ documentId: otherDoc.id, subjectId: owner.id });
    await Effect.runPromise(repo.save(p));

    const policies = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(policies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findByDocumentAndSubject
// ---------------------------------------------------------------------------

describe("findByDocumentAndSubject", () => {
  it("returns only policies for the given subject", async () => {
    const otherUser = makeUser();
    await Effect.runPromise(userRepo.save(otherUser));

    const myPolicy = makeSubjectPolicy({ documentId: doc.id, subjectId: owner.id });
    const theirPolicy = makeSubjectPolicy({ documentId: doc.id, subjectId: otherUser.id });
    await Promise.all([
      Effect.runPromise(repo.save(myPolicy)),
      Effect.runPromise(repo.save(theirPolicy)),
    ]);

    const result = await Effect.runPromise(repo.findByDocumentAndSubject(doc.id, owner.id));
    expect(result).toHaveLength(1);
    if (Option.isSome(result[0]!.subjectId)) {
      expect(result[0]!.subjectId.value).toBe(owner.id);
    }
  });
});

// ---------------------------------------------------------------------------
// findByDocumentAndRole
// ---------------------------------------------------------------------------

describe("findByDocumentAndRole", () => {
  it("returns role-based policies for the given role", async () => {
    const adminPolicy = makeRolePolicy({
      documentId: doc.id,
      subjectRole: Role.Admin,
      action: PermissionAction.Read,
    });
    const userPolicy = makeRolePolicy({
      documentId: doc.id,
      subjectRole: Role.User,
      action: PermissionAction.Read,
    });
    await Promise.all([
      Effect.runPromise(repo.save(adminPolicy)),
      Effect.runPromise(repo.save(userPolicy)),
    ]);

    const adminPolicies = await Effect.runPromise(repo.findByDocumentAndRole(doc.id, Role.Admin));
    expect(adminPolicies).toHaveLength(1);
    if (Option.isSome(adminPolicies[0]!.subjectRole)) {
      expect(adminPolicies[0]!.subjectRole.value).toBe(Role.Admin);
    }
  });

  it("returns empty when no role policies exist for a role", async () => {
    const result = await Effect.runPromise(repo.findByDocumentAndRole(doc.id, Role.Admin));
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findByDocumentSubjectAndAction
// ---------------------------------------------------------------------------

describe("findByDocumentSubjectAndAction", () => {
  it("returns exact action match for subject", async () => {
    const readPolicy = makeSubjectPolicy({
      documentId: doc.id,
      subjectId: owner.id,
      action: PermissionAction.Read,
    });
    const writePolicy = makeSubjectPolicy({
      documentId: doc.id,
      subjectId: owner.id,
      action: PermissionAction.Write,
    });
    await Promise.all([
      Effect.runPromise(repo.save(readPolicy)),
      Effect.runPromise(repo.save(writePolicy)),
    ]);

    const result = await Effect.runPromise(
      repo.findByDocumentSubjectAndAction(doc.id, owner.id, PermissionAction.Read),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.action).toBe(PermissionAction.Read);
  });
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

describe("save", () => {
  it("persists a subject policy with all fields", async () => {
    const policy = makeSubjectPolicy({
      documentId: doc.id,
      subjectId: owner.id,
      action: PermissionAction.Delete,
      effect: PolicyEffect.Deny,
    });
    await Effect.runPromise(repo.save(policy));

    const found = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(policy.id);
    expect(found[0]!.action).toBe(PermissionAction.Delete);
    expect(found[0]!.effect).toBe(PolicyEffect.Deny);
  });

  it("persists a role-based policy with correct role", async () => {
    const policy = makeRolePolicy({
      documentId: doc.id,
      subjectRole: Role.User,
      action: PermissionAction.Read,
    });
    await Effect.runPromise(repo.save(policy));

    const found = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(found).toHaveLength(1);
    expect(Option.isNone(found[0]!.subjectId)).toBe(true);
    expect(Option.isSome(found[0]!.subjectRole)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("delete", () => {
  it("removes the policy from findByDocument", async () => {
    const policy = makeSubjectPolicy({ documentId: doc.id, subjectId: owner.id });
    await Effect.runPromise(repo.save(policy));

    await Effect.runPromise(repo.delete(policy.id));

    const found = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(found).toHaveLength(0);
  });

  it("returns AccessPolicyNotFoundError for unknown id", async () => {
    const id = AccessPolicyId.create(crypto.randomUUID()).unwrap();
    const result = await Effect.runPromise(Effect.either(repo.delete(id)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(AccessPolicyNotFoundError);
    }
  });
});

// ---------------------------------------------------------------------------
// deleteByDocument
// ---------------------------------------------------------------------------

describe("deleteByDocument", () => {
  it("removes all policies for a document at once", async () => {
    const p1 = makeSubjectPolicy({
      documentId: doc.id,
      subjectId: owner.id,
      action: PermissionAction.Read,
    });
    const p2 = makeRolePolicy({
      documentId: doc.id,
      subjectRole: Role.User,
      action: PermissionAction.Write,
    });
    await Promise.all([Effect.runPromise(repo.save(p1)), Effect.runPromise(repo.save(p2))]);

    await Effect.runPromise(repo.deleteByDocument(doc.id));

    const found = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(found).toHaveLength(0);
  });

  it("does not affect policies for a different document", async () => {
    const otherDoc = makeDocument({ ownerId: owner.id });
    await Effect.runPromise(docRepo.save(otherDoc));

    const p1 = makeSubjectPolicy({ documentId: doc.id, subjectId: owner.id });
    const p2 = makeSubjectPolicy({ documentId: otherDoc.id, subjectId: owner.id });
    await Promise.all([Effect.runPromise(repo.save(p1)), Effect.runPromise(repo.save(p2))]);

    await Effect.runPromise(repo.deleteByDocument(doc.id));

    const otherPolicies = await Effect.runPromise(repo.findByDocument(otherDoc.id));
    expect(otherPolicies).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: serialization fidelity
// ---------------------------------------------------------------------------

describe("round-trip serialization", () => {
  it("subject policy: all fields survived DB round-trip", async () => {
    const policy = makeSubjectPolicy({
      documentId: doc.id,
      subjectId: owner.id,
      action: PermissionAction.Share,
      effect: PolicyEffect.Allow,
    });
    await Effect.runPromise(repo.save(policy));

    const found = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(found).toHaveLength(1);
    const p = found[0]!;
    expect(p.id).toBe(policy.id);
    expect(p.documentId).toBe(doc.id);
    expect(Option.isSome(p.subjectId)).toBe(true);
    expect(Option.isNone(p.subjectRole)).toBe(true);
    expect(p.action).toBe(PermissionAction.Share);
    expect(p.effect).toBe(PolicyEffect.Allow);
  });

  it("role policy: all fields survived DB round-trip", async () => {
    const policy = makeRolePolicy({
      documentId: doc.id,
      subjectRole: Role.Admin,
      action: PermissionAction.Delete,
      effect: PolicyEffect.Allow,
    });
    await Effect.runPromise(repo.save(policy));

    const found = await Effect.runPromise(repo.findByDocument(doc.id));
    expect(found).toHaveLength(1);
    const p = found[0]!;
    expect(Option.isNone(p.subjectId)).toBe(true);
    expect(Option.isSome(p.subjectRole)).toBe(true);
    if (Option.isSome(p.subjectRole)) {
      expect(p.subjectRole.value).toBe(Role.Admin);
    }
    expect(p.action).toBe(PermissionAction.Delete);
  });
});
