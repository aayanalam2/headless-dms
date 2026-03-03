import { faker } from "@faker-js/faker";
import { Effect, Either } from "effect";
import type { AppError } from "../../src/types/errors.ts";
import { Role } from "../../src/types/enums.ts";
import type {
  DocumentRow,
  UserRow,
  VersionRow,
} from "../../src/models/db/schema.ts";
import type { JwtClaims } from "../../src/services/auth.service.ts";

// ---------------------------------------------------------------------------
// Effect runner helpers — shared across all test files.
// ---------------------------------------------------------------------------

export function runOk<T>(effect: Effect.Effect<T, unknown>): T {
  return Effect.runSync(effect);
}

export function runOkAsync<T>(effect: Effect.Effect<T, unknown>): Promise<T> {
  return Effect.runPromise(effect);
}

export function runErr<E>(effect: Effect.Effect<unknown, E>): E {
  const result = Effect.runSync(Effect.either(effect));
  if (Either.isRight(result)) throw new Error("Expected failure but got success");
  return result.left;
}

export async function runErrAsync<E>(effect: Effect.Effect<unknown, E>): Promise<E> {
  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isRight(result)) throw new Error("Expected failure but got success");
  return result.left;
}

// ---------------------------------------------------------------------------
// Row factories — each returns a fully-populated row with sensible defaults
// that can be overridden via a partial override argument.
// ---------------------------------------------------------------------------

export function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    passwordHash: faker.string.alphanumeric(60),
    role: faker.helpers.arrayElement([Role.Admin, Role.User]),
    createdAt: faker.date.past(),
    ...overrides,
  };
}

export function makeDocumentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  const now = new Date();
  return {
    id: faker.string.uuid(),
    ownerId: faker.string.uuid(),
    name: `${faker.system.fileName()}.pdf`,
    contentType: faker.system.mimeType(),
    currentVersionId: null,
    tags: faker.helpers.arrayElements(["finance", "legal", "hr", "q1", "report"], {
      min: 0,
      max: 3,
    }),
    metadata: {
      author: faker.person.fullName(),
    },
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

export function makeVersionRow(
  documentId: string,
  overrides: Partial<VersionRow> = {},
): VersionRow {
  return {
    id: faker.string.uuid(),
    documentId,
    versionNumber: faker.number.int({ min: 1, max: 100 }),
    bucketKey: `${documentId}/${faker.string.uuid()}/${faker.system.fileName()}`,
    sizeBytes: faker.number.int({ min: 512, max: 10_000_000 }),
    uploadedBy: faker.string.uuid(),
    checksum: faker.string.hexadecimal({ length: 64, casing: "lower", prefix: "" }),
    createdAt: faker.date.recent(),
    ...overrides,
  };
}

export function makeAdminClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    userId: faker.string.uuid(),
    email: faker.internet.email(),
    role: Role.Admin,
    ...overrides,
  };
}

export function makeUserClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    userId: faker.string.uuid(),
    email: faker.internet.email(),
    role: Role.User,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AppError constructor aliases (type-narrowed) for expect assertions.
// ---------------------------------------------------------------------------

export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "tag" in e &&
    typeof (e as AppError).tag === "string"
  );
}
