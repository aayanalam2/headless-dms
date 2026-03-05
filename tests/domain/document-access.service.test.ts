// ---------------------------------------------------------------------------
// Unit tests for DocumentAccessService.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "bun:test";
import { Effect, Option, Schema } from "effect";
import { createDocumentAccessService } from "../../src/app/domain/services/document-access.service.ts";
import { Document } from "../../src/app/domain/document/document.entity.ts";
import { User } from "../../src/app/domain/user/user.entity.ts";
import { AccessPolicy } from "../../src/app/domain/access-policy/access-policy.entity.ts";
import { Permission } from "../../src/app/domain/access-policy/permission.ts";
import { Role } from "../../src/types/enums.ts";
import { AccessDeniedError } from "../../src/app/domain/utils/base.errors.ts";
import { DocumentAlreadyDeletedError } from "../../src/app/domain/document/document.errors.ts";
import {
  DocumentIdSchema,
  VersionIdSchema,
  UserIdSchema,
  AccessPolicyIdSchema,
  EmailSchema,
  HashedPasswordSchema,
} from "../../src/app/domain/utils/refined.types.ts";
import { ContentTypeSchema } from "../../src/app/domain/document/value-objects/content-type.vo.ts";
import { InvalidContentTypeError } from "../../src/app/domain/document/document.errors.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserId() {
  return Schema.decodeSync(UserIdSchema)(crypto.randomUUID());
}
function makeDocId() {
  return Schema.decodeSync(DocumentIdSchema)(crypto.randomUUID());
}

function makeUser(overrides: { role?: Role; id?: ReturnType<typeof makeUserId> } = {}) {
  const id = overrides.id ?? makeUserId();
  const email = Schema.decodeSync(EmailSchema)(`${id.slice(0, 8)}@test.com`);
  const passwordHash = Schema.decodeSync(HashedPasswordSchema)("$2b$10$hash");
  const now = new Date();
  return User.create({ id, email, passwordHash, role: overrides.role ?? Role.User, createdAt: now, updatedAt: now });
}

function makeDocument(ownerId: ReturnType<typeof makeUserId>) {
  const id = makeDocId();
  const contentType = Schema.decodeSync(ContentTypeSchema)("application/pdf");
  const now = new Date();
  const result = Document.create({ id, ownerId, name: "file.pdf", contentType, tags: [], metadata: {}, createdAt: now, updatedAt: now });
  if (result instanceof InvalidContentTypeError) throw result;
  return result;
}

function makePolicy(
  documentId: ReturnType<typeof makeDocId>,
  userId: ReturnType<typeof makeUserId>,
  grantedBy: ReturnType<typeof makeUserId>,
  permission: Permission,
) {
  const id = Schema.decodeSync(AccessPolicyIdSchema)(crypto.randomUUID());
  return AccessPolicy.create({ id, documentId, userId, grantedBy, permission, createdAt: new Date(), updatedAt: new Date() });
}

async function runOk<T>(effect: Effect.Effect<T, unknown>) {
  return Effect.runPromise(effect);
}

async function runFail<E>(effect: Effect.Effect<unknown, E>): Promise<E> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (result._tag !== "Left") throw new Error("Expected failure but got success");
  return result.left as E;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DocumentAccessService", () => {
  const service = createDocumentAccessService();

  describe("assertCanRead", () => {
    it("allows admin to read any document", async () => {
      const admin = makeUser({ role: Role.Admin });
      const doc = makeDocument(makeUserId());
      await expect(runOk(service.assertCanRead(admin, doc, Option.none()))).resolves.toBeUndefined();
    });

    it("allows document owner to read", async () => {
      const owner = makeUser();
      const doc = makeDocument(owner.id);
      await expect(runOk(service.assertCanRead(owner, doc, Option.none()))).resolves.toBeUndefined();
    });

    it("allows user with Read policy to read", async () => {
      const owner = makeUser();
      const reader = makeUser();
      const doc = makeDocument(owner.id);
      const policy = makePolicy(doc.id, reader.id, owner.id, Permission.Read);
      await expect(
        runOk(service.assertCanRead(reader, doc, Option.some(policy))),
      ).resolves.toBeUndefined();
    });

    it("denies user with no policy", async () => {
      const owner = makeUser();
      const stranger = makeUser();
      const doc = makeDocument(owner.id);
      const err = await runFail(service.assertCanRead(stranger, doc, Option.none()));
      expect(err).toBeInstanceOf(AccessDeniedError);
    });

    it("denies access to deleted document even for owner", async () => {
      const owner = makeUser();
      const doc = makeDocument(owner.id);
      const deleted = doc.softDelete();
      if (deleted instanceof DocumentAlreadyDeletedError) {
        throw new Error("Expected softDelete to succeed");
      }
      const err = await runFail(service.assertCanRead(owner, deleted, Option.none()));
      expect(err).toBeInstanceOf(DocumentAlreadyDeletedError);
    });
  });

  describe("assertCanWrite", () => {
    it("allows owner to write", async () => {
      const owner = makeUser();
      const doc = makeDocument(owner.id);
      await expect(runOk(service.assertCanWrite(owner, doc, Option.none()))).resolves.toBeUndefined();
    });

    it("allows user with Write policy", async () => {
      const owner = makeUser();
      const editor = makeUser();
      const doc = makeDocument(owner.id);
      const policy = makePolicy(doc.id, editor.id, owner.id, Permission.Write);
      await expect(
        runOk(service.assertCanWrite(editor, doc, Option.some(policy))),
      ).resolves.toBeUndefined();
    });

    it("denies user with Read-only policy", async () => {
      const owner = makeUser();
      const reader = makeUser();
      const doc = makeDocument(owner.id);
      const policy = makePolicy(doc.id, reader.id, owner.id, Permission.Read);
      const err = await runFail(service.assertCanWrite(reader, doc, Option.some(policy)));
      expect(err).toBeInstanceOf(AccessDeniedError);
    });
  });

  describe("assertCanDelete", () => {
    it("allows admin to delete", async () => {
      const admin = makeUser({ role: Role.Admin });
      const doc = makeDocument(makeUserId());
      await expect(runOk(service.assertCanDelete(admin, doc, Option.none()))).resolves.toBeUndefined();
    });

    it("allows owner to delete", async () => {
      const owner = makeUser();
      const doc = makeDocument(owner.id);
      await expect(runOk(service.assertCanDelete(owner, doc, Option.none()))).resolves.toBeUndefined();
    });

    it("denies non-owner with only Write policy (delete requires Admin permission)", async () => {
      const owner = makeUser();
      const editor = makeUser();
      const doc = makeDocument(owner.id);
      const policy = makePolicy(doc.id, editor.id, owner.id, Permission.Write);
      const err = await runFail(service.assertCanDelete(editor, doc, Option.some(policy)));
      expect(err).toBeInstanceOf(AccessDeniedError);
    });
  });

  describe("assertCanManageAccess", () => {
    it("allows user with Admin policy to manage access", async () => {
      const owner = makeUser();
      const manager = makeUser();
      const doc = makeDocument(owner.id);
      const policy = makePolicy(doc.id, manager.id, owner.id, Permission.Admin);
      await expect(
        runOk(service.assertCanManageAccess(manager, doc, Option.some(policy))),
      ).resolves.toBeUndefined();
    });

    it("denies user with Write policy from managing access", async () => {
      const owner = makeUser();
      const editor = makeUser();
      const doc = makeDocument(owner.id);
      const policy = makePolicy(doc.id, editor.id, owner.id, Permission.Write);
      const err = await runFail(service.assertCanManageAccess(editor, doc, Option.some(policy)));
      expect(err).toBeInstanceOf(AccessDeniedError);
    });
  });
});
