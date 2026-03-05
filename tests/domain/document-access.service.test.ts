// ---------------------------------------------------------------------------
// Unit tests for DocumentAccessService.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "bun:test";
import { Option } from "effect";
import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role } from "@domain/utils/enums.ts";
import {
  FIXED_DATE as _FIXED_DATE,
  makeAdminUser,
  makeAllowAllScenario,
  makeDocument,
  makeRolePolicy,
  makeSubjectPolicy,
  makeUser,
  makeUserId,
} from "./factories.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for evaluating a single action. */
function check(
  user: Parameters<typeof DocumentAccessService.evaluate>[0],
  policies: Parameters<typeof DocumentAccessService.evaluate>[1],
  document: Parameters<typeof DocumentAccessService.evaluate>[2],
  action: PermissionAction,
): boolean {
  return DocumentAccessService.evaluate(user, policies, document, action);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DocumentAccessService", () => {
  // -------------------------------------------------------------------------
  // Admin bypass
  // -------------------------------------------------------------------------

  describe("Admin bypass", () => {
    it("Admin can read any document regardless of policies", () => {
      const admin = makeAdminUser();
      const doc = makeDocument();
      expect(check(admin, [], doc, PermissionAction.Read)).toBe(true);
    });

    it("Admin can perform all actions with no policies", () => {
      const admin = makeAdminUser();
      const doc = makeDocument();
      for (const action of Object.values(PermissionAction)) {
        expect(check(admin, [], doc, action)).toBe(true);
      }
    });

    it("Admin is not affected by a Deny policy", () => {
      const admin = makeAdminUser();
      const doc = makeDocument();
      const denyPolicy = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: admin.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Deny,
      });
      expect(check(admin, [denyPolicy], doc, PermissionAction.Read)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Subject-level policies (user-specific)
  // -------------------------------------------------------------------------

  describe("Subject-level (user-specific) policies", () => {
    it("allows access when a matching subject Allow policy exists", () => {
      const user = makeUser();
      const doc = makeDocument();
      const allow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      expect(check(user, [allow], doc, PermissionAction.Read)).toBe(true);
    });

    it("denies access when a matching subject Deny policy exists", () => {
      const user = makeUser();
      const doc = makeDocument();
      const deny = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Deny,
      });
      expect(check(user, [deny], doc, PermissionAction.Read)).toBe(false);
    });

    it("a single Deny in the subject tier overrides Allow policies in the same tier", () => {
      const user = makeUser();
      const doc = makeDocument();
      const allow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Write,
        effect: PolicyEffect.Allow,
      });
      const deny = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Write,
        effect: PolicyEffect.Deny,
      });
      expect(check(user, [allow, deny], doc, PermissionAction.Write)).toBe(false);
    });

    it("policies for a different user do not affect evaluation", () => {
      const user = makeUser();
      const otherUser = makeUser();
      const doc = makeDocument();
      const otherAllow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: otherUser.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      expect(check(user, [otherAllow], doc, PermissionAction.Read)).toBe(false);
    });

    it("policies for a different document do not affect evaluation", () => {
      const user = makeUser();
      const doc = makeDocument();
      const otherDoc = makeDocument();
      const allow = makeSubjectPolicy({
        documentId: otherDoc.id,
        subjectId: user.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      expect(check(user, [allow], doc, PermissionAction.Read)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Role-level policies
  // -------------------------------------------------------------------------

  describe("Role-level policies", () => {
    it("allows access when a matching role Allow policy exists", () => {
      const user = makeUser({ role: Role.User });
      const doc = makeDocument();
      const roleAllow = makeRolePolicy({
        documentId: doc.id,
        subjectRole: Option.some(Role.User),
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      expect(check(user, [roleAllow], doc, PermissionAction.Read)).toBe(true);
    });

    it("denies access when a matching role Deny policy exists", () => {
      const user = makeUser({ role: Role.User });
      const doc = makeDocument();
      const roleDeny = makeRolePolicy({
        documentId: doc.id,
        subjectRole: Option.some(Role.User),
        action: PermissionAction.Delete,
        effect: PolicyEffect.Deny,
      });
      expect(check(user, [roleDeny], doc, PermissionAction.Delete)).toBe(false);
    });

    it("role policy for a different role does not grant access", () => {
      const user = makeUser({ role: Role.User });
      const doc = makeDocument();
      const adminRoleAllow = makeRolePolicy({
        documentId: doc.id,
        subjectRole: Option.some(Role.Admin),
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      expect(check(user, [adminRoleAllow], doc, PermissionAction.Read)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Tier precedence: subject overrides role
  // -------------------------------------------------------------------------

  describe("Tier precedence — subject overrides role", () => {
    it("subject Deny overrides a role Allow for the same action", () => {
      const user = makeUser({ role: Role.User });
      const doc = makeDocument();

      const subjectDeny = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Write,
        effect: PolicyEffect.Deny,
      });
      const roleAllow = makeRolePolicy({
        documentId: doc.id,
        subjectRole: Option.some(Role.User),
        action: PermissionAction.Write,
        effect: PolicyEffect.Allow,
      });

      expect(check(user, [subjectDeny, roleAllow], doc, PermissionAction.Write)).toBe(false);
    });

    it("subject Allow overrides a role Deny for the same action", () => {
      const user = makeUser({ role: Role.User });
      const doc = makeDocument();

      const subjectAllow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      const roleDeny = makeRolePolicy({
        documentId: doc.id,
        subjectRole: Option.some(Role.User),
        action: PermissionAction.Read,
        effect: PolicyEffect.Deny,
      });

      expect(check(user, [subjectAllow, roleDeny], doc, PermissionAction.Read)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Default deny
  // -------------------------------------------------------------------------

  describe("Default deny", () => {
    it("returns false with no policies", () => {
      const user = makeUser();
      const doc = makeDocument();
      expect(check(user, [], doc, PermissionAction.Read)).toBe(false);
    });

    it("returns false when policies exist for a different action only", () => {
      const user = makeUser();
      const doc = makeDocument();
      const readAllow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      expect(check(user, [readAllow], doc, PermissionAction.Write)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // evaluateAll
  // -------------------------------------------------------------------------

  describe("evaluateAll", () => {
    it("returns a full map of all actions for the allow-all scenario", () => {
      const { user, document, allowAllPolicies } = makeAllowAllScenario();
      const result = DocumentAccessService.evaluateAll(user, allowAllPolicies, document);

      expect(result[PermissionAction.Read]).toBe(true);
      expect(result[PermissionAction.Write]).toBe(true);
      expect(result[PermissionAction.Delete]).toBe(true);
      expect(result[PermissionAction.Share]).toBe(true);
    });

    it("returns false for all actions when there are no policies", () => {
      const user = makeUser();
      const doc = makeDocument();
      const result = DocumentAccessService.evaluateAll(user, [], doc);

      for (const action of Object.values(PermissionAction)) {
        expect(result[action]).toBe(false);
      }
    });

    it("returns all-true for an admin with no policies", () => {
      const admin = makeAdminUser();
      const doc = makeDocument();
      const result = DocumentAccessService.evaluateAll(admin, [], doc);

      for (const action of Object.values(PermissionAction)) {
        expect(result[action]).toBe(true);
      }
    });

    it("selectively reflects mixed allow/deny across actions", () => {
      const user = makeUser();
      const doc = makeDocument();

      const readAllow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      const writeDeny = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: user.id,
        action: PermissionAction.Write,
        effect: PolicyEffect.Deny,
      });

      const result = DocumentAccessService.evaluateAll(user, [readAllow, writeDeny], doc);

      expect(result[PermissionAction.Read]).toBe(true);
      expect(result[PermissionAction.Write]).toBe(false);
      expect(result[PermissionAction.Delete]).toBe(false);
      expect(result[PermissionAction.Share]).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Owner vs policy
  // -------------------------------------------------------------------------

  describe("Owner vs policy interaction", () => {
    it("a regular-user owner is still subject to evaluation (no implicit owner bypass)", () => {
      const owner = makeUser();
      const doc = makeDocument({ ownerId: owner.id });
      expect(check(owner, [], doc, PermissionAction.Read)).toBe(false);
    });

    it("owner with an explicit Allow policy can access the document", () => {
      const owner = makeUser();
      const doc = makeDocument({ ownerId: owner.id });
      const allow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: owner.id,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      });
      expect(check(owner, [allow], doc, PermissionAction.Read)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Subject ID isolation
  // -------------------------------------------------------------------------

  describe("Subject ID isolation", () => {
    it("a policy for a different user does not grant the current user access", () => {
      const user = makeUser();
      const otherUserId = makeUserId();
      const doc = makeDocument();
      const policy = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: otherUserId,
        action: PermissionAction.Share,
        effect: PolicyEffect.Allow,
      });
      expect(check(user, [policy], doc, PermissionAction.Share)).toBe(false);
    });
  });
});
