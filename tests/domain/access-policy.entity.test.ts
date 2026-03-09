import { describe, expect, it } from "bun:test";
import { Effect as E } from "effect";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import {
  appliesTo,
  isAllowPolicy,
  isDenyPolicy,
} from "@domain/access-policy/access-policy.guards.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import {
  FIXED_DATE,
  makeAccessPolicyId,
  makeDocId,
  makeSubjectPolicy,
  makeUserId,
} from "./factories.ts";

// ---------------------------------------------------------------------------
// AccessPolicy.create
// ---------------------------------------------------------------------------

describe("AccessPolicy entity", () => {
  describe("AccessPolicy.create", () => {
    it("creates a user-specific (subject) policy", () => {
      const userId = makeUserId();
      const docId = makeDocId();
      const policy = makeSubjectPolicy({
        documentId: docId,
        subjectId: userId,
        action: PermissionAction.Write,
        effect: PolicyEffect.Allow,
      });

      expect(policy).toBeInstanceOf(AccessPolicy);
      expect(policy.subjectId).toBe(userId);
      expect(policy.documentId).toBe(docId);
      expect(policy.action).toBe(PermissionAction.Write);
      expect(policy.effect).toBe(PolicyEffect.Allow);
    });

    it("accepts a valid subjectId and parses correctly", () => {
      const user = E.runSync(
        AccessPolicy.create({
          id: crypto.randomUUID(),
          documentId: crypto.randomUUID(),
          subjectId: crypto.randomUUID(),
          action: PermissionAction.Read,
          effect: PolicyEffect.Allow,
          createdAt: FIXED_DATE.toISOString(),
        }),
      );

      expect(user).toBeInstanceOf(AccessPolicy);
    });

    it("sets updatedAt equal to createdAt (immutable record)", () => {
      const policy = makeSubjectPolicy({ createdAt: FIXED_DATE.toISOString() });
      expect(policy.updatedAt).toEqual(policy.createdAt);
    });
  });

  // ---------------------------------------------------------------------------
  // AccessPolicy.reconstitute
  // ---------------------------------------------------------------------------

  describe("AccessPolicy.reconstitute", () => {
    it("reconstructs a policy from trusted props without validation", () => {
      const id = makeAccessPolicyId();
      const userId = makeUserId();
      const docId = makeDocId();

      const policy = AccessPolicy.reconstitute({
        id,
        documentId: docId,
        subjectId: userId,
        action: PermissionAction.Delete,
        effect: PolicyEffect.Deny,
        createdAt: FIXED_DATE,
      });

      expect(policy.id).toBe(id);
      expect(policy.subjectId).toBe(userId);
      expect(policy.action).toBe(PermissionAction.Delete);
      expect(policy.effect).toBe(PolicyEffect.Deny);
    });
  });

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  describe("serialized", () => {
    it("serializes a subject policy with correct field values", () => {
      const userId = makeUserId();
      const policy = makeSubjectPolicy({ subjectId: userId as string });
      const s = E.runSync(policy.serialized());

      expect(s.subjectId).toBe(userId);
      expect(s.createdAt).toBe(FIXED_DATE.toISOString());
    });

    it("serializes action and effect as their string values", () => {
      const policy = makeSubjectPolicy({
        action: PermissionAction.Share,
        effect: PolicyEffect.Deny,
      });
      const s = E.runSync(policy.serialized());

      expect(s.action).toBe(PermissionAction.Share);
      expect(s.effect).toBe(PolicyEffect.Deny);
    });
  });

  // ---------------------------------------------------------------------------
  // Equality
  // ---------------------------------------------------------------------------

  describe("equals", () => {
    it("two policies sharing the same id are equal", () => {
      const id = makeAccessPolicyId();
      const a = makeSubjectPolicy({ id });
      const b = makeSubjectPolicy({ id });
      expect(a.equals(b)).toBe(true);
    });

    it("policies with different ids are not equal", () => {
      expect(makeSubjectPolicy().equals(makeSubjectPolicy())).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  describe("isAllowPolicy / isDenyPolicy", () => {
    it("isAllowPolicy is true for an Allow effect", () => {
      const p = makeSubjectPolicy({ effect: PolicyEffect.Allow });
      expect(isAllowPolicy(p)).toBe(true);
      expect(isDenyPolicy(p)).toBe(false);
    });

    it("isDenyPolicy is true for a Deny effect", () => {
      const p = makeSubjectPolicy({ effect: PolicyEffect.Deny });
      expect(isDenyPolicy(p)).toBe(true);
      expect(isAllowPolicy(p)).toBe(false);
    });
  });

  describe("appliesTo", () => {
    it("appliesTo returns true when policy targets the given user", () => {
      const userId = makeUserId();
      const policy = makeSubjectPolicy({ subjectId: userId });
      expect(appliesTo(policy, userId)).toBe(true);
    });

    it("appliesTo returns false for a different user", () => {
      const policy = makeSubjectPolicy({ subjectId: makeUserId() });
      expect(appliesTo(policy, makeUserId())).toBe(false);
    });
  });
});
