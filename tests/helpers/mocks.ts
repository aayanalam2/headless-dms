import { Effect, Option } from "effect";
import { AppError } from "../../src/types/errors.ts";
import type {
  AuditLogRow,
  DocumentRow,
  NewAuditLogRow,
  NewDocumentRow,
  NewVersionRow,
  VersionRow,
  NewUserRow,
  UserRow,
} from "../../src/models/db/schema.ts";
import type { IDocumentRepository } from "../../src/models/document.repository.ts";
import type { IUserRepository } from "../../src/models/user.repository.ts";
import type { IStorage } from "../../src/infra/repositories/storage.port.ts";
import type { BucketKey } from "../../src/types/branded.ts";

// ---------------------------------------------------------------------------
// createInMemoryDocumentRepository
// A fully in-memory implementation of IDocumentRepository for use in tests.
// Pre-populate `docs`, `versions`, and `auditLogs` arrays before running
// effects, or call the mutation methods from inside test effects.
// ---------------------------------------------------------------------------

export function createInMemoryDocumentRepository(initial?: {
  docs?: DocumentRow[];
  versions?: VersionRow[];
  logs?: AuditLogRow[];
}): IDocumentRepository {
  const docs: DocumentRow[] = [...(initial?.docs ?? [])];
  const versions: VersionRow[] = [...(initial?.versions ?? [])];
  const logs: AuditLogRow[] = [...(initial?.logs ?? [])];

  return {
    findDocumentById(id, actorId) {
      const doc = docs.find(
        (d) =>
          d.id === id && d.deletedAt === null && (actorId === undefined || d.ownerId === actorId),
      );
      return doc ? Effect.succeed(doc) : Effect.fail(AppError.notFound(`Document(${id})`));
    },

    searchDocuments(params) {
      let results = docs.filter((d) => d.deletedAt === null);
      if (Option.isSome(params.ownerId)) {
        results = results.filter((d) => d.ownerId === params.ownerId.value);
      }
      if (Option.isSome(params.name)) {
        const needle = params.name.value.toLowerCase();
        results = results.filter((d) => d.name.toLowerCase().includes(needle));
      }
      if (Option.isSome(params.contentType)) {
        results = results.filter((d) => d.contentType === params.contentType.value);
      }
      const total = results.length;
      const offset = (params.page - 1) * params.limit;
      const items = results.slice(offset, offset + params.limit);
      return Effect.succeed({ items, total, page: params.page, limit: params.limit });
    },

    createDocument(data: NewDocumentRow) {
      const now = new Date();
      const row: DocumentRow = {
        id: data.id ?? crypto.randomUUID(),
        ownerId: data.ownerId!,
        name: data.name!,
        contentType: data.contentType!,
        currentVersionId: data.currentVersionId ?? null,
        tags: data.tags ?? [],
        metadata: (data.metadata ?? {}) as Record<string, string>,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      docs.push(row);
      return Effect.succeed(row);
    },

    updateDocument(id, data) {
      const idx = docs.findIndex((d) => d.id === id && d.deletedAt === null);
      if (idx === -1) return Effect.fail(AppError.notFound(`Document(${id})`));
      docs[idx] = { ...docs[idx], ...data };
      return Effect.succeed(docs[idx]);
    },

    softDeleteDocument(id) {
      const idx = docs.findIndex((d) => d.id === id && d.deletedAt === null);
      if (idx === -1) return Effect.fail(AppError.notFound(`Document(${id})`));
      docs[idx] = { ...docs[idx], deletedAt: new Date() };
      return Effect.succeed(docs[idx]);
    },

    createVersion(data: NewVersionRow) {
      const row: VersionRow = {
        id: data.id ?? crypto.randomUUID(),
        documentId: data.documentId!,
        versionNumber: data.versionNumber!,
        bucketKey: data.bucketKey!,
        sizeBytes: data.sizeBytes!,
        uploadedBy: data.uploadedBy!,
        checksum: data.checksum!,
        createdAt: new Date(),
      };
      versions.push(row);
      return Effect.succeed(row);
    },

    listVersions(documentId) {
      return Effect.succeed(
        versions
          .filter((v) => v.documentId === documentId)
          .sort((a, b) => a.versionNumber - b.versionNumber),
      );
    },

    findVersionById(versionId) {
      const version = versions.find((v) => v.id === versionId);
      return version
        ? Effect.succeed(version)
        : Effect.fail(AppError.notFound(`Version(${versionId})`));
    },

    insertAuditLog(data: NewAuditLogRow) {
      const row: AuditLogRow = {
        id: crypto.randomUUID(),
        actorId: data.actorId!,
        action: data.action!,
        resourceType: data.resourceType!,
        resourceId: data.resourceId!,
        metadata: (data.metadata ?? {}) as Record<string, unknown>,
        occurredAt: new Date(),
      };
      logs.push(row);
      return Effect.succeed(row);
    },

    listAuditLogs(params) {
      let results = [...logs];
      if (Option.isSome(params.resourceType)) {
        results = results.filter((l) => l.resourceType === params.resourceType.value);
      }
      if (Option.isSome(params.resourceId)) {
        results = results.filter((l) => l.resourceId === params.resourceId.value);
      }
      results.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      const total = results.length;
      const offset = (params.page - 1) * params.limit;
      const items = results.slice(offset, offset + params.limit);
      return Effect.succeed({ items, total });
    },
  };
}

// ---------------------------------------------------------------------------
// createInMemoryUserRepository
// ---------------------------------------------------------------------------

export function createInMemoryUserRepository(initial?: { users?: UserRow[] }): IUserRepository {
  const users: UserRow[] = [...(initial?.users ?? [])];

  return {
    findUserById(id) {
      const user = users.find((u) => u.id === id);
      return user ? Effect.succeed(user) : Effect.fail(AppError.notFound(`User(${id})`));
    },

    findUserByEmail(email) {
      const user = users.find((u) => u.email === email);
      return user ? Effect.succeed(user) : Effect.fail(AppError.notFound(`User(email:${email})`));
    },

    createUser(data: NewUserRow) {
      const row: UserRow = {
        id: data.id ?? crypto.randomUUID(),
        email: data.email!,
        passwordHash: data.passwordHash!,
        role: data.role ?? "user",
        createdAt: new Date(),
      };
      users.push(row);
      return Effect.succeed(row);
    },

    updateUser(id, data) {
      const idx = users.findIndex((u) => u.id === id);
      if (idx === -1) return Effect.fail(AppError.notFound(`User(${id})`));
      users[idx] = { ...users[idx], ...data };
      return Effect.succeed(users[idx]);
    },
  };
}

// ---------------------------------------------------------------------------
// createInMemoryStorage
// A no-op IStorage implementation for tests. uploadFile and deleteFile
// succeed silently; getPresignedDownloadUrl returns a deterministic fake URL.
// ---------------------------------------------------------------------------

export function createInMemoryStorage(): IStorage {
  return {
    uploadFile(_key, _body, _contentType) {
      return Effect.succeed(undefined);
    },

    getPresignedDownloadUrl(key: BucketKey, _expiresInSeconds?: number) {
      return Effect.succeed(`https://fake-storage.test/${key as string}?X-Test=1`);
    },

    deleteFile(_key) {
      return Effect.succeed(undefined);
    },
  };
}
