// ---------------------------------------------------------------------------
// Unit tests for DocumentAccessService.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "bun:test";

import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { Role as _Role } from "@domain/utils/enums.ts";
import {
  FIXED_DATE as _FIXED_DATE,
  makeAdminUser,
  makeAllowAllScenario,
  makeDocument,
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
  // Owner bypass
  // -------------------------------------------------------------------------

  describe("Owner bypass", () => {
    it("owner can Read a document without any explicit policies", () => {
      const owner = makeUser();
      const doc = makeDocument({ ownerId: owner.id as string });
      expect(check(owner, [], doc, PermissionAction.Read)).toBe(true);
    });

    it("owner can Write to a document without any explicit policies", () => {
      const owner = makeUser();
      const doc = makeDocument({ ownerId: owner.id as string });
      expect(check(owner, [], doc, PermissionAction.Write)).toBe(true);
    });

    it("owner can Share a document without any explicit policies", () => {
      const owner = makeUser();
      const doc = makeDocument({ ownerId: owner.id as string });
      expect(check(owner, [], doc, PermissionAction.Share)).toBe(true);
    });

    it("owner CANNOT Delete without an explicit Allow policy", () => {
      const owner = makeUser();
      const doc = makeDocument({ ownerId: owner.id as string });
      expect(check(owner, [], doc, PermissionAction.Delete)).toBe(false);
    });

    it("owner with an explicit Delete Allow policy can delete", () => {
      const owner = makeUser();
      const doc = makeDocument({ ownerId: owner.id as string });
      const deleteAllow = makeSubjectPolicy({
        documentId: doc.id,
        subjectId: owner.id,
        action: PermissionAction.Delete,
        effect: PolicyEffect.Allow,
      });
      expect(check(owner, [deleteAllow], doc, PermissionAction.Delete)).toBe(true);
    });

    it("owner bypass does not apply when the user is not the owner", () => {
      const owner = makeUser();
      const otherUser = makeUser();
      const doc = makeDocument({ ownerId: owner.id as string });
      expect(check(otherUser, [], doc, PermissionAction.Read)).toBe(false);
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
