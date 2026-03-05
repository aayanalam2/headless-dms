import { describe, expect, it } from "bun:test";
import { Option } from "effect";
import { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";
import { PolicyTargetRequiredError } from "@domain/access-policy/access-policy.errors.ts";
import {
  appliesTo,
  appliesToRole,
  isAllowPolicy,
  isDenyPolicy,
  isRolePolicy,
  isSubjectPolicy,
} from "@domain/access-policy/access-policy.guards.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";
import {
  FIXED_DATE,
  makeAccessPolicyId,
  makeDocId,
  makeRolePolicy,
  makeSubjectPolicy,
  makeUserId,
} from "./factories.ts";

// ---------------------------------------------------------------------------
// AccessPolicy.create — XOR invariant
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
      expect(Option.isSome(policy.subjectId)).toBe(true);
      if (Option.isSome(policy.subjectId)) expect(policy.subjectId.value).toBe(userId);
      expect(Option.isNone(policy.subjectRole)).toBe(true);
      expect(policy.documentId).toBe(docId);
      expect(policy.action).toBe(PermissionAction.Write);
      expect(policy.effect).toBe(PolicyEffect.Allow);
    });

    it("creates a role-based policy", () => {
      const policy = makeRolePolicy({ subjectRole: Role.Admin });

      expect(policy).toBeInstanceOf(AccessPolicy);
      expect(Option.isNone(policy.subjectId)).toBe(true);
      expect(Option.isSome(policy.subjectRole)).toBe(true);
      if (Option.isSome(policy.subjectRole)) expect(policy.subjectRole.value).toBe(Role.Admin);
    });

    it("returns PolicyTargetRequiredError when neither subjectId nor subjectRole is set", () => {
      const result = AccessPolicy.create({
        id: makeAccessPolicyId(),
        documentId: makeDocId(),
        subjectId: null,
        subjectRole: null,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
        createdAt: FIXED_DATE,
      });

      expect(result).toBeInstanceOf(PolicyTargetRequiredError);
    });

    it("returns PolicyTargetRequiredError when both subjectId and subjectRole are set", () => {
      const result = AccessPolicy.create({
        id: makeAccessPolicyId(),
        documentId: makeDocId(),
        subjectId: makeUserId(),
        subjectRole: Role.User,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
        createdAt: FIXED_DATE,
      });

      expect(result).toBeInstanceOf(PolicyTargetRequiredError);
    });

    it("accepts undefined as 'not provided' for optional targets", () => {
      const result = AccessPolicy.create({
        id: makeAccessPolicyId(),
        documentId: makeDocId(),
        subjectId: makeUserId(),
        subjectRole: undefined,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
        createdAt: FIXED_DATE,
      });

      expect(result).toBeInstanceOf(AccessPolicy);
    });

    it("sets updatedAt equal to createdAt (immutable record)", () => {
      const policy = makeSubjectPolicy({ createdAt: FIXED_DATE });
      expect(policy.updatedAt).toEqual(policy.createdAt);
    });
  });

  // ---------------------------------------------------------------------------
  // AccessPolicy.reconstitute
  // ---------------------------------------------------------------------------

  describe("AccessPolicy.reconstitute", () => {
    it("reconstructs a policy from trusted props without XOR validation", () => {
      const id = makeAccessPolicyId();
      const userId = makeUserId();
      const docId = makeDocId();

      const policy = AccessPolicy.reconstitute(id, FIXED_DATE, {
        documentId: docId,
        subjectId: Option.some(userId),
        subjectRole: Option.none(),
        action: PermissionAction.Delete,
        effect: PolicyEffect.Deny,
      });

      expect(policy.id).toBe(id);
      expect(policy.action).toBe(PermissionAction.Delete);
      expect(policy.effect).toBe(PolicyEffect.Deny);
    });
  });

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  describe("_serialize", () => {
    it("serializes a subject policy with subjectRole as null", () => {
      const userId = makeUserId();
      const policy = makeSubjectPolicy({ subjectId: userId });
      const s = policy._serialize();

      expect(s.subjectId).toBe(userId);
      expect(s.subjectRole).toBeNull();
      expect(s.createdAt).toBe(FIXED_DATE.toISOString());
    });

    it("serializes a role policy with subjectId as null", () => {
      const policy = makeRolePolicy({ subjectRole: Role.Admin });
      const s = policy._serialize();

      expect(s.subjectId).toBeNull();
      expect(s.subjectRole).toBe(Role.Admin);
    });

    it("serializes action and effect as their string values", () => {
      const policy = makeSubjectPolicy({
        action: PermissionAction.Share,
        effect: PolicyEffect.Deny,
      });
      const s = policy._serialize();

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

  describe("isSubjectPolicy / isRolePolicy", () => {
    it("isSubjectPolicy is true for a user-specific policy", () => {
      expect(isSubjectPolicy(makeSubjectPolicy())).toBe(true);
      expect(isRolePolicy(makeSubjectPolicy())).toBe(false);
    });

    it("isRolePolicy is true for a role-based policy", () => {
      expect(isRolePolicy(makeRolePolicy())).toBe(true);
      expect(isSubjectPolicy(makeRolePolicy())).toBe(false);
    });
  });

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

  describe("appliesTo / appliesToRole", () => {
    it("appliesTo returns true when policy targets the given user", () => {
      const userId = makeUserId();
      const policy = makeSubjectPolicy({ subjectId: userId });
      expect(appliesTo(policy, userId)).toBe(true);
    });

    it("appliesTo returns false for a different user", () => {
      const policy = makeSubjectPolicy({ subjectId: makeUserId() });
      expect(appliesTo(policy, makeUserId())).toBe(false);
    });

    it("appliesToRole returns true when policy targets the given role", () => {
      const policy = makeRolePolicy({ subjectRole: Role.Admin });
      expect(appliesToRole(policy, Role.Admin)).toBe(true);
    });

    it("appliesToRole returns false for a different role", () => {
      const policy = makeRolePolicy({ subjectRole: Role.Admin });
      expect(appliesToRole(policy, Role.User)).toBe(false);
    });
  });
});
