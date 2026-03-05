import { Effect, Option } from "effect";
import type { IDocumentRepository } from "../../src/domain/document/document.repository.ts";
import type { IUserRepository } from "../../src/domain/user/user.repository.ts";
import type { IStorage } from "../../src/infra/repositories/storage.port.ts";
import type { Document } from "../../src/domain/document/document.entity.ts";
import type { DocumentVersion } from "../../src/domain/document/document-version.entity.ts";
import type { User } from "../../src/domain/user/user.entity.ts";
import type {
  DocumentId,
  UserId,
  VersionId,
  BucketKey,
} from "../../src/domain/utils/refined.types.ts";
import type { PaginationParams } from "../../src/domain/utils/pagination.ts";
import { buildPageInfo } from "../../src/domain/utils/pagination.ts";
import {
  DocumentNotFoundError,
  DocumentVersionNotFoundError,
} from "../../src/domain/document/document.errors.ts";
import { UserNotFoundError, UserAlreadyExistsError } from "../../src/domain/user/user.errors.ts";

// ---------------------------------------------------------------------------
// createInMemoryDocumentRepository
// A fully in-memory implementation of the domain IDocumentRepository.
// Pre-populate `docs` and `versions` arrays before running effects, or call
// the mutation methods from inside test effects.
// ---------------------------------------------------------------------------

export function createInMemoryDocumentRepository(initial?: {
  docs?: Document[];
  versions?: DocumentVersion[];
}): IDocumentRepository {
  const docs: Document[] = [...(initial?.docs ?? [])];
  const versions: DocumentVersion[] = [...(initial?.versions ?? [])];

  return {
    findById(id: DocumentId) {
      const doc = docs.find((d) => d.id === id);
      return Effect.succeed(doc ? Option.some(doc) : Option.none());
    },

    findActiveById(id: DocumentId) {
      const doc = docs.find((d) => d.id === id && Option.isNone(d.deletedAt));
      return Effect.succeed(doc ? Option.some(doc) : Option.none());
    },

    findByOwner(ownerId: UserId, pagination: PaginationParams) {
      const filtered = docs.filter((d) => d.ownerId === ownerId && Option.isNone(d.deletedAt));
      const total = filtered.length;
      const offset = (pagination.page - 1) * pagination.limit;
      const items = filtered.slice(offset, offset + pagination.limit);
      return Effect.succeed({
        items,
        pageInfo: buildPageInfo(total, pagination.page, pagination.limit),
      });
    },

    search(query: string, pagination: PaginationParams) {
      const needle = query.toLowerCase();
      const filtered = docs.filter(
        (d) => Option.isNone(d.deletedAt) && d.name.toLowerCase().includes(needle),
      );
      const total = filtered.length;
      const offset = (pagination.page - 1) * pagination.limit;
      const items = filtered.slice(offset, offset + pagination.limit);
      return Effect.succeed({
        items,
        pageInfo: buildPageInfo(total, pagination.page, pagination.limit),
      });
    },

    findVersionsByDocument(documentId: DocumentId) {
      const result = versions
        .filter((v) => v.documentId === documentId)
        .sort((a, b) => a.versionNumber - b.versionNumber);
      return Effect.succeed(result);
    },

    findVersionById(versionId: VersionId) {
      const version = versions.find((v) => v.id === versionId);
      return Effect.succeed(version ? Option.some(version) : Option.none());
    },

    save(document: Document) {
      docs.push(document);
      return Effect.succeed(undefined);
    },

    saveVersion(version: DocumentVersion) {
      versions.push(version);
      return Effect.succeed(undefined);
    },

    update(document: Document) {
      const idx = docs.findIndex((d) => d.id === document.id);
      if (idx === -1) return Effect.fail(new DocumentNotFoundError(document.id));
      docs[idx] = document;
      return Effect.succeed(undefined);
    },

    deleteVersion(versionId: VersionId) {
      const idx = versions.findIndex((v) => v.id === versionId);
      if (idx === -1) return Effect.fail(new DocumentVersionNotFoundError(versionId));
      versions.splice(idx, 1);
      return Effect.succeed(undefined);
    },
  };
}

// ---------------------------------------------------------------------------
// createInMemoryUserRepository
// ---------------------------------------------------------------------------

export function createInMemoryUserRepository(initial?: { users?: User[] }): IUserRepository {
  const users: User[] = [...(initial?.users ?? [])];

  return {
    findById(id: UserId) {
      const user = users.find((u) => u.id === id);
      return Effect.succeed(user ? Option.some(user) : Option.none());
    },

    findByEmail(email) {
      const user = users.find((u) => u.email === email);
      return Effect.succeed(user ? Option.some(user) : Option.none());
    },

    save(user: User) {
      const existing = users.find((u) => u.email === user.email);
      if (existing) return Effect.fail(new UserAlreadyExistsError(user.email));
      users.push(user);
      return Effect.succeed(undefined);
    },

    update(user: User) {
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx === -1) return Effect.fail(new UserNotFoundError(user.id));
      users[idx] = user;
      return Effect.succeed(undefined);
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
