/**
 * user.repository.test.ts — integration tests for DrizzleUserRepository.
 *
 * Runs against a real Postgres instance managed by Testcontainers.
 * Container start + migration happen once per file (beforeAll/afterAll).
 * Each test gets a clean slate via truncateAll() in beforeEach.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { Effect, Either, Option } from "effect";

import { makeAdminUser, makeUser, makeUserId } from "../domain/factories.ts";
import type { TestDb } from "./helpers/db.ts";
import { startTestDb, stopTestDb, truncateAll } from "./helpers/db.ts";
import { DrizzleUserRepository } from "@infra/repositories/drizzle-user.repository.ts";
import { UserAlreadyExistsError, UserNotFoundError } from "@domain/user/user.errors.ts";
import { Email } from "@domain/utils/refined.types.ts";

// Container startup can take up to ~30 s on a cold Docker pull
setDefaultTimeout(60_000);

let db: TestDb;
let repo: DrizzleUserRepository;

beforeAll(async () => {
  db = await startTestDb();
  repo = new DrizzleUserRepository(db);
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe("findById", () => {
  it("returns None when user does not exist", async () => {
    const result = await Effect.runPromise(repo.findById(makeUserId()));
    expect(Option.isNone(result)).toBe(true);
  });

  it("returns Some(user) after save", async () => {
    const user = makeUser();
    await Effect.runPromise(repo.save(user));

    const result = await Effect.runPromise(repo.findById(user.id));
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.id).toBe(user.id);
      expect(result.value.email).toBe(user.email);
      expect(result.value.role).toBe(user.role);
    }
  });
});

// ---------------------------------------------------------------------------
// findByEmail
// ---------------------------------------------------------------------------

describe("findByEmail", () => {
  it("returns None for unknown email", async () => {
    const email = Email.create("unknown@example.com").unwrap();
    const result = await Effect.runPromise(repo.findByEmail(email));
    expect(Option.isNone(result)).toBe(true);
  });

  it("returns Some(user) matching saved email (case-sensitive)", async () => {
    const user = makeUser();
    await Effect.runPromise(repo.save(user));

    const result = await Effect.runPromise(repo.findByEmail(user.email));
    expect(Option.isSome(result)).toBe(true);
    if (Option.isSome(result)) {
      expect(result.value.id).toBe(user.id);
    }
  });
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

describe("save", () => {
  it("persists a regular user", async () => {
    const user = makeUser();
    await Effect.runPromise(repo.save(user));

    const found = await Effect.runPromise(repo.findById(user.id));
    expect(Option.isSome(found)).toBe(true);
  });

  it("persists an admin user with correct role", async () => {
    const admin = makeAdminUser();
    await Effect.runPromise(repo.save(admin));

    const found = await Effect.runPromise(repo.findById(admin.id));
    expect(Option.isSome(found)).toBe(true);
    if (Option.isSome(found)) {
      expect(found.value.role).toBe(admin.role);
    }
  });

  it("returns UserAlreadyExistsError on duplicate email", async () => {
    const user = makeUser();
    await Effect.runPromise(repo.save(user));

    // Try saving another user with the same email
    const duplicate = makeUser({ email: user.email });
    const result = await Effect.runPromise(Effect.either(repo.save(duplicate)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UserAlreadyExistsError);
    }
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("update", () => {
  it("reflects changes when re-fetched by id", async () => {
    const user = makeUser();
    await Effect.runPromise(repo.save(user));

    // Create an updated user with a different role (same id)
    const updated = makeAdminUser({ id: user.id, email: user.email });
    await Effect.runPromise(repo.update(updated));

    const found = await Effect.runPromise(repo.findById(user.id));
    expect(Option.isSome(found)).toBe(true);
    if (Option.isSome(found)) {
      expect(found.value.role).toBe(updated.role);
    }
  });

  it("returns UserNotFoundError for nonexistent id", async () => {
    const phantom = makeUser();
    const result = await Effect.runPromise(Effect.either(repo.update(phantom)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(UserNotFoundError);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip integrity
// ---------------------------------------------------------------------------

describe("round-trip", () => {
  it("preserves all scalar fields through save → findById", async () => {
    const user = makeAdminUser();
    await Effect.runPromise(repo.save(user));

    const found = await Effect.runPromise(repo.findById(user.id));
    expect(Option.isSome(found)).toBe(true);
    if (Option.isSome(found)) {
      const u = found.value;
      expect(u.id).toBe(user.id);
      expect(u.email).toBe(user.email);
      expect(u.passwordHash).toBe(user.passwordHash);
      expect(u.role).toBe(user.role);
    }
  });

  it("two users can be saved and retrieved independently by email", async () => {
    const alice = makeUser();
    const bob = makeAdminUser();
    await Promise.all([Effect.runPromise(repo.save(alice)), Effect.runPromise(repo.save(bob))]);

    const [foundAlice, foundBob] = await Promise.all([
      Effect.runPromise(repo.findByEmail(alice.email)),
      Effect.runPromise(repo.findByEmail(bob.email)),
    ]);

    expect(Option.isSome(foundAlice)).toBe(true);
    expect(Option.isSome(foundBob)).toBe(true);
    if (Option.isSome(foundAlice) && Option.isSome(foundBob)) {
      expect(foundAlice.value.id).not.toBe(foundBob.value.id);
    }
  });
});
