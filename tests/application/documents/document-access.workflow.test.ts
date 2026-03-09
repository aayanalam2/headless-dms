/**
 * Document workflow tests — access control integration
 *
 * These tests exercise the full application layer for each document action
 * that is gated by an AccessPolicy.  They use fully in-memory repository
 * implementations so there is no I/O or database involved.
 *
 * Key invariants verified:
 *   • Owner bypass applies for Read / Write / Share — NOT for Delete.
 *   • Explicit Allow/Deny policies are evaluated by DocumentAccessService.
 *   • Admin role bypasses every check.
 *   • Successful writes emit the correct audit-log entry via the event bus.
 *   • Failed writes do NOT emit audit-log entries.
 */

import "reflect-metadata";
import { describe, expect, it } from "bun:test";
import { Effect as E, Either } from "effect";
import { DocumentWorkflows } from "@application/documents/document.workflows.ts";
import { DocumentWorkflowErrorTag } from "@application/documents/document-workflow.errors.ts";
import { DocumentAccessGuard } from "@application/security/document-access.guard.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";
import { AuditAction, Role } from "@domain/utils/enums.ts";
import { createAuditListeners } from "@application/audit/audit.listener.ts";
import {
  createInMemoryDocumentRepository,
  createInMemoryStorage,
  createInMemoryAuditRepository,
} from "../../helpers/mocks.ts";
import { makeDocument, makeUser, makeSubjectPolicy } from "../../domain/factories.ts";
import type { Document } from "@domain/document/document.entity.ts";
import type { AccessPolicy } from "@domain/access-policy/access-policy.entity.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Give any pending `E.runFork` fibers (audit writes) time to complete. */
const flushEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

function makeWorkflows(initial: { docs?: Document[]; policies?: AccessPolicy[] }) {
  const docRepo = createInMemoryDocumentRepository({
    docs: initial.docs ?? [],
    policies: initial.policies ?? [],
  });
  const storage = createInMemoryStorage();
  const accessGuard = new DocumentAccessGuard(docRepo);
  return { workflows: new DocumentWorkflows(docRepo, storage, accessGuard) };
}

const makePdf = (name = "file.pdf"): File =>
  new File(["fake-pdf-bytes"], name, { type: "application/pdf" });

// ---------------------------------------------------------------------------
// uploadVersion — requires Write permission
// ---------------------------------------------------------------------------

describe("uploadVersion — access control", () => {
  it("owner can upload a new version (implicit Write bypass)", async () => {
    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.uploadVersion(
          {
            actor: { userId: owner.id as string, role: Role.User },
            documentId: doc.id as string,
          },
          makePdf(),
        ),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("non-owner without any policy is denied", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.uploadVersion(
          {
            actor: { userId: other.id as string, role: Role.User },
            documentId: doc.id as string,
          },
          makePdf(),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(DocumentWorkflowErrorTag.AccessDenied);
    }
  });

  it("non-owner with Write Allow policy can upload", async () => {
    const owner = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const writePolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Write,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [writePolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.uploadVersion(
          {
            actor: { userId: grantee.id as string, role: Role.User },
            documentId: doc.id as string,
          },
          makePdf(),
        ),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("non-owner with Write Deny policy is denied even with no other policies", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const denyPolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: other.id as string,
      action: PermissionAction.Write,
      effect: PolicyEffect.Deny,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [denyPolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.uploadVersion(
          {
            actor: { userId: other.id as string, role: Role.User },
            documentId: doc.id as string,
          },
          makePdf(),
        ),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(DocumentWorkflowErrorTag.AccessDenied);
    }
  });

  it("admin can upload regardless of policies", async () => {
    const owner = makeUser();
    const admin = makeUser({ role: Role.Admin });
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.uploadVersion(
          {
            actor: { userId: admin.id as string, role: Role.Admin },
            documentId: doc.id as string,
          },
          makePdf(),
        ),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("emits DocumentVersionCreate audit log on success", async () => {
    const auditRepo = createInMemoryAuditRepository();
    createAuditListeners(auditRepo).register();

    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    await E.runPromise(
      workflows.uploadVersion(
        {
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
        },
        makePdf(),
      ),
    );

    await flushEventLoop();

    const ownEntries = auditRepo.entries.filter(
      (e) => e.action === AuditAction.DocumentVersionCreate && e.actorId === (owner.id as string),
    );
    expect(ownEntries.length).toBeGreaterThanOrEqual(1);
    expect(ownEntries[0]!.resourceId).toBe(doc.id as string);
  });
});

// ---------------------------------------------------------------------------
// delete — requires Delete permission (NOT bypassed by document ownership)
// ---------------------------------------------------------------------------

describe("delete — access control", () => {
  it("owner WITHOUT an explicit Delete policy is denied", async () => {
    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.delete({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(DocumentWorkflowErrorTag.AccessDenied);
    }
  });

  it("owner WITH an explicit Delete Allow policy can delete", async () => {
    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const deletePolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: owner.id as string,
      action: PermissionAction.Delete,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [deletePolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.delete({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("non-owner without any policy is denied", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.delete({
          actor: { userId: other.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(DocumentWorkflowErrorTag.AccessDenied);
    }
  });

  it("non-owner with a Write policy (wrong action) is still denied for delete", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    // Write ≠ Delete — wrong action, so evaluation falls through to default deny
    const writePolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: other.id as string,
      action: PermissionAction.Write,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [writePolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.delete({
          actor: { userId: other.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(DocumentWorkflowErrorTag.AccessDenied);
    }
  });

  it("non-owner with an explicit Delete Allow policy can delete", async () => {
    const owner = makeUser();
    const grantee = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const deletePolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: grantee.id as string,
      action: PermissionAction.Delete,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [deletePolicy] });

    const result = await E.runPromise(
      E.either(
        workflows.delete({
          actor: { userId: grantee.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("admin can delete without any explicit policy", async () => {
    const owner = makeUser();
    const admin = makeUser({ role: Role.Admin });
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.delete({
          actor: { userId: admin.id as string, role: Role.Admin },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("emits DocumentDelete audit log on successful delete", async () => {
    const auditRepo = createInMemoryAuditRepository();
    createAuditListeners(auditRepo).register();

    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const deletePolicy = makeSubjectPolicy({
      documentId: doc.id as string,
      subjectId: owner.id as string,
      action: PermissionAction.Delete,
      effect: PolicyEffect.Allow,
    });
    const { workflows } = makeWorkflows({ docs: [doc], policies: [deletePolicy] });

    await E.runPromise(
      workflows.delete({
        actor: { userId: owner.id as string, role: Role.User },
        documentId: doc.id as string,
      }),
    );

    await flushEventLoop();

    const ownEntries = auditRepo.entries.filter(
      (e) => e.action === AuditAction.DocumentDelete && e.actorId === (owner.id as string),
    );
    expect(ownEntries.length).toBeGreaterThanOrEqual(1);
    expect(ownEntries[0]!.resourceId).toBe(doc.id as string);
  });

  it("does NOT emit a DocumentDelete audit log when delete is denied", async () => {
    const auditRepo = createInMemoryAuditRepository();
    createAuditListeners(auditRepo).register();

    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    // No Delete policy — owner bypass does not apply to Delete
    const { workflows } = makeWorkflows({ docs: [doc] });

    await E.runPromise(
      E.either(
        workflows.delete({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    await flushEventLoop();

    const ownEntries = auditRepo.entries.filter(
      (e) => e.action === AuditAction.DocumentDelete && e.actorId === (owner.id as string),
    );
    expect(ownEntries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// get — requires Read permission
// ---------------------------------------------------------------------------

describe("get — access control", () => {
  it("owner can read their own document", async () => {
    const owner = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.get({
          actor: { userId: owner.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(doc.id as string);
    }
  });

  it("non-owner without any policy is denied", async () => {
    const owner = makeUser();
    const other = makeUser();
    const doc = makeDocument({ ownerId: owner.id as string });
    const { workflows } = makeWorkflows({ docs: [doc] });

    const result = await E.runPromise(
      E.either(
        workflows.get({
          actor: { userId: other.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(DocumentWorkflowErrorTag.AccessDenied);
    }
  });

  it("non-owner with Read Allow policy can read", async () => {
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
        workflows.get({
          actor: { userId: reader.id as string, role: Role.User },
          documentId: doc.id as string,
        }),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
  });

  it("returns NotFound for a non-existent document", async () => {
    const user = makeUser();
    const { workflows } = makeWorkflows({ docs: [] });

    const result = await E.runPromise(
      E.either(
        workflows.get({
          actor: { userId: user.id as string, role: Role.User },
          documentId: crypto.randomUUID(),
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(DocumentWorkflowErrorTag.NotFound);
    }
  });
});
