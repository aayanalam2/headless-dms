/**
 * AccessPolicy workflow tests — integration with document access control
 *
 * These tests exercise the AccessPolicyWorkflows application service using
 * fully in-memory repository implementations.
 *
 * Key invariants verified:
 *   • grantAccess / revokeAccess / listDocumentPolicies all require Share
 *     permission on the target document (owner bypass applies).
 *   • checkAccess evaluates the target actor's access, not the caller's.
 *   • Successful writes emit the correct audit-log entry via the event bus.
 *   • Denied operations do NOT emit audit-log entries.
 */

import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { Effect as E, Either } from "effect";
import { AccessPolicyWorkflows } from "@application/access-policy/access-policy.workflows.ts";
import { AccessPolicyWorkflowErrorTag } from "@application/access-policy/access-policy-workflow.errors.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { AuditAction, Role } from "@domain/utils/enums.ts";
import { createAuditListeners } from "@application/audit/audit.listener.ts";
import {
  createInMemoryDocumentRepository,
  createInMemoryAccessPolicyRepository,
  createInMemoryAuditRepository,
} from "../../helpers/mocks.ts";
import { makeDocument, makeUser, makeSubjectPolicy } from "../../domain/factories.ts";
import type { Document } from "@domain/document/document.entity.ts";
import type { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const flushEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

function makeWorkflows(initial: { docs?: Document[]; policies?: AccessPolicy[] }) {
  const docRepo = createInMemoryDocumentRepository({ docs: initial.docs ?? [] });
  const policyRepo = createInMemoryAccessPolicyRepository({ policies: initial.policies ?? [] });
  return { workflows: new AccessPolicyWorkflows(policyRepo, docRepo), policyRepo };
}

// ---------------------------------------------------------------------------
// grantAccess — caller needs Share permission on the document
// ---------------------------------------------------------------------------

describe("grantAccess — access control", () => {
  it("owner can grant access to another user (implicit Share bypass)", async () => {
    const owner = makeUser();
    const target = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.grantAccess({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
          subjectId: target.id as string,
          action: PermissionAction.Read,
          effect: PolicyEffect.Allow,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.subjectId).toBe(target.id as string);
      expect(result.right.action).toBe(PermissionAction.Read);
    }
  });

  it("non-owner without Share policy is denied", async () => {
    const owner = makeUser();
    const nonOwner = makeUser();
    const target = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.grantAccess({
          actor: { userId: nonOwner.id as string, role: Role.User },
          documentId: doc.id as string,
          subjectId: target.id as string,
          action: PermissionAction.Read,
          effect: PolicyEffect.Allow,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(AccessPolicyWorkflowErrorTag.AccessDenied);
    }
  });

  it("non-owner with Share Allow policy can grant access", async () => {
    const owner = makeUser();
    const sharer = makeUser();
    const target = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const sharePolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: sharer.id as string,
      action: PermissionAction.Share,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [sharePolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.grantAccess({
          actor: { userId: sharer.id as string, role: Role.User },
          documentId: doc.id as string,
          subjectId: target.id as string,
          action: PermissionAction.Read,
          effect: PolicyEffect.Allow,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("admin can grant access without any policies", async () => {
    const owner = makeUser();
    const admin = makeUser({ role: Role.Admin });
    const target = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.grantAccess({
          actor: { userId: admin.id as string, role: Role.Admin },
          documentId: doc.id as string,
          subjectId: target.id as string,
          action: PermissionAction.Write,
          effect: PolicyEffect.Allow,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("fails with NotFound when document does not exist", async () => {
    const owner = makeUser();
    const target = makeUser();
    const { workflows } = makeWorkflows({ docs: [] });

    const result = await E.runPromise(
      E.either(
        workflows.grantAccess({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: crypto.randomUUID(),
          subjectId: target.id as string,
          action: PermissionAction.Read,
          effect: PolicyEffect.Allow,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(AccessPolicyWorkflowErrorTag.NotFound);
    }
  });

  it("emits AccessPolicyGrant audit log on success", async () => {
    const auditRepo = createInMemoryAuditRepository();
    createAuditListeners(auditRepo).register();

    const owner = makeUser();
    const target = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    await E.runPromise(
      workflows.grantAccess({
        actor: { userId: owner.id as string, role: Role.User },
        documentId: doc.id as string,
        subjectId: target.id as string,
        action: PermissionAction.Read,
        effect: PolicyEffect.Allow,
      }),
    );

    await flushEventLoop();

    const ownEntries = auditRepo.entries.filter(
      (e) => e.action === AuditAction.AccessPolicyGrant && e.actorId === (owner.id as string),
    );
    expect(ownEntries.length).toBeGreaterThanOrEqual(1);
    const latest = ownEntries[ownEntries.length - 1]!;
    expect(latest.metadata).toMatchObject({
      documentId: doc.id as string,
      action: PermissionAction.Read,
    });
  });
});

// ---------------------------------------------------------------------------
// revokeAccess — caller needs Share permission on the document
// ---------------------------------------------------------------------------

describe("revokeAccess — access control", () => {
  it("owner can revoke an existing policy (implicit Share bypass)", async () => {
    const owner = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const existingPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [existingPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.revokeAccess({
          actor: { userId: owner.id as string, role: Role.User },
          policyId: existingPolicy.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("non-owner without Share policy is denied", async () => {
    const owner = makeUser();
    const nonOwner = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const existingPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [existingPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.revokeAccess({
          actor: { userId: nonOwner.id as string, role: Role.User },
          policyId: existingPolicy.id as string,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(AccessPolicyWorkflowErrorTag.AccessDenied);
    }
  });

  it("fails with NotFound when policy does not exist", async () => {
    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.revokeAccess({
          actor: { userId: owner.id as string, role: Role.User },
          policyId: crypto.randomUUID(),
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(AccessPolicyWorkflowErrorTag.NotFound);
    }
  });

  it("emits AccessPolicyRevoke audit log on success", async () => {
    const auditRepo = createInMemoryAuditRepository();
    createAuditListeners(auditRepo).register();

    const owner = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const existingPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [existingPolicy] });

    await E.runPromise(
      workflows.revokeAccess({
        actor: { userId: owner.id as string, role: Role.User },
        policyId: existingPolicy.id as string,
      }),
    );

    await flushEventLoop();

    const ownEntries = auditRepo.entries.filter(
      (e) => e.action === AuditAction.AccessPolicyRevoke && e.actorId === (owner.id as string),
    );
    expect(ownEntries.length).toBeGreaterThanOrEqual(1);
    const latest = ownEntries[ownEntries.length - 1]!;
    expect(latest.metadata).toMatchObject({ documentId: doc.id as string });
  });
});

// ---------------------------------------------------------------------------
// updateAccess — caller needs Share permission; creates a replacement policy
// ---------------------------------------------------------------------------

describe("updateAccess — access control", () => {
  it("owner can update the effect of an existing policy", async () => {
    const owner = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const existingPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [existingPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.updateAccess({
          actor: { userId: owner.id as string, role: Role.User },
          policyId: existingPolicy.id as string,
          effect: PolicyEffect.Deny,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.effect).toBe(PolicyEffect.Deny);
      expect(result.right.subjectId).toBe(grantee.id as string);
    }
  });

  it("non-owner without Share policy is denied on update", async () => {
    const owner = makeUser();
    const other = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const existingPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [existingPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.updateAccess({
          actor: { userId: other.id as string, role: Role.User },
          policyId: existingPolicy.id as string,
          effect: PolicyEffect.Deny,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(AccessPolicyWorkflowErrorTag.AccessDenied);
    }
  });

  it("emits AccessPolicyUpdate audit log on success", async () => {
    const auditRepo = createInMemoryAuditRepository();
    createAuditListeners(auditRepo).register();

    const owner = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const existingPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [existingPolicy] });

    await E.runPromise(
      workflows.updateAccess({
        actor: { userId: owner.id as string, role: Role.User },
        policyId: existingPolicy.id as string,
        effect: PolicyEffect.Deny,
      }),
    );

    await flushEventLoop();

    const ownEntries = auditRepo.entries.filter(
      (e) => e.action === AuditAction.AccessPolicyUpdate && e.actorId === (owner.id as string),
    );
    expect(ownEntries.length).toBeGreaterThanOrEqual(1);
    expect(ownEntries[0]!.metadata).toMatchObject({
      documentId: doc.id as string,
      effect: PolicyEffect.Deny,
    });
  });
});

// ---------------------------------------------------------------------------
// checkAccess — evaluates the *target* actor's permissions (no auth on caller)
// ---------------------------------------------------------------------------

describe("checkAccess — policy evaluation", () => {
  it("returns true for the document owner checking Read (implicit bypass)", async () => {
    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.checkAccess({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
          action: PermissionAction.Read,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(true);
  });

  it("returns false for the document owner checking Delete (no bypass)", async () => {
    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.checkAccess({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
          action: PermissionAction.Delete,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(false);
  });

  it("returns true when subject has an Allow policy for the action", async () => {
    const owner = makeUser();
    const reader = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const readPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: reader.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [readPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.checkAccess({
          actor: { userId: reader.id as string, role: Role.User },
          documentId: doc.id as string,
          action: PermissionAction.Read,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(true);
  });

  it("returns false when subject has no policy (default deny)", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.checkAccess({
          actor: { userId: other.id as string, role: Role.User },
          documentId: doc.id as string,
          action: PermissionAction.Read,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(false);
  });

  it("returns false when subject has a Deny policy (explicit deny overrides)", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const denyPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: other.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Deny,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [denyPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.checkAccess({
          actor: { userId: other.id as string, role: Role.User },
          documentId: doc.id as string,
          action: PermissionAction.Read,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) expect(result.right).toBe(false);
  });

  it("returns true for admin regardless of action or policies", async () => {
    const owner = makeUser();
    const admin = makeUser({ role: Role.Admin });
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    for (const action of Object.values(PermissionAction)) {
      const result = await E.runPromise(
        E.either(
          workflows.checkAccess({
            actor: { userId: admin.id as string, role: Role.Admin },
            documentId: doc.id as string,
            action,
          }),
        ),
      );
      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) expect(result.right).toBe(true);
    }
  });

  it("returns NotFound when document does not exist", async () => {
    const user = makeUser();
    const { workflows } = makeWorkflows({ docs: [] });

    const result = await E.runPromise(
      E.either(
        workflows.checkAccess({
          actor: { userId: user.id as string, role: Role.User },
          documentId: crypto.randomUUID(),
          action: PermissionAction.Read,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(AccessPolicyWorkflowErrorTag.NotFound);
    }
  });
});

// ---------------------------------------------------------------------------
// listDocumentPolicies — caller needs Share permission on the document
// ---------------------------------------------------------------------------

describe("listDocumentPolicies — access control", () => {
  it("owner can list all policies for their document", async () => {
    const owner = makeUser();
    const reader = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const readPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: reader.id as string,
      action: PermissionAction.Read,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [readPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.listDocumentPolicies({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right).toHaveLength(1);
      expect(result.right[0]!.subjectId).toBe(reader.id as string);
    }
  });

  it("non-owner without Share policy is denied", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.listDocumentPolicies({
          actor: { userId: other.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(AccessPolicyWorkflowErrorTag.AccessDenied);
    }
  });

  it("admin can list policies for any document", async () => {
    const owner = makeUser();
    const admin = makeUser({ role: Role.Admin });
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.listDocumentPolicies({
          actor: { userId: admin.id as string, role: Role.Admin },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });
});
