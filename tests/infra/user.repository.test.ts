/**
 * user.repository.test.ts — integration tests for DrizzleUserRepository.
 *
 * Runs against a real Postgres instance managed by Testcontainers.
 * Container start + migration happen once per file (beforeAll/afterAll).
 * Each test gets a clean slate via truncateAll() in beforeEach.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { Effect as E, Either, Option as O } from "effect";

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
  it("returns O.none() when user does not exist", async () => {
    const result = await E.runPromise(repo.findById(makeUserId()));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns O.some(user) after save", async () => {
    const user = makeUser();
    await E.runPromise(repo.save(user));

    const result = await E.runPromise(repo.findById(user.id));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
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
  it("returns O.none() for unknown email", async () => {
    const email = Email.create("unknown@example.com").unwrap();
    const result = await E.runPromise(repo.findByEmail(email));
    expect(O.isNone(result)).toBe(true);
  });

  it("returns O.some(user) matching saved email (case-sensitive)", async () => {
    const user = makeUser();
    await E.runPromise(repo.save(user));

    const result = await E.runPromise(repo.findByEmail(user.email));
    expect(O.isSome(result)).toBe(true);
    if (O.isSome(result)) {
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
    await E.runPromise(repo.save(user));

    const found = await E.runPromise(repo.findById(user.id));
    expect(O.isSome(found)).toBe(true);
    if (O.isSome(found)) expect(found.value.id).toBe(user.id);
  });

  it("persists an admin user with correct role", async () => {
    const admin = makeAdminUser();
    await E.runPromise(repo.save(admin));

    const found = await E.runPromise(repo.findById(admin.id));
    expect(O.isSome(found)).toBe(true);
    if (O.isSome(found)) expect(found.value.role).toBe(admin.role);
  });

  it("returns UserAlreadyExistsError on duplicate email", async () => {
    const user = makeUser();
    await E.runPromise(repo.save(user));

    // Try saving another user with the same email
    const duplicate = makeUser({ email: user.email });
    const result = await E.runPromise(E.either(repo.save(duplicate)));

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
    await E.runPromise(repo.save(user));

    // Create an updated user with a different role (same id)
    const updated = makeAdminUser({ id: user.id, email: user.email });
    await E.runPromise(repo.update(updated));

    const found = await E.runPromise(repo.findById(user.id));
    expect(O.isSome(found)).toBe(true);
    if (O.isSome(found)) expect(found.value.role).toBe(updated.role);
  });

  it("returns UserNotFoundError for nonexistent id", async () => {
    const phantom = makeUser();
    const result = await E.runPromise(E.either(repo.update(phantom)));

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
    await E.runPromise(repo.save(user));

    const found = await E.runPromise(repo.findById(user.id));
    expect(O.isSome(found)).toBe(true);
    if (O.isSome(found)) {
      expect(found.value.id).toBe(user.id);
      expect(found.value.email).toBe(user.email);
      expect(found.value.passwordHash).toBe(user.passwordHash);
      expect(found.value.role).toBe(user.role);
    }
  });

  it("two users can be saved and retrieved independently by email", async () => {
    const alice = makeUser();
    const bob = makeAdminUser();
    await Promise.all([E.runPromise(repo.save(alice)), E.runPromise(repo.save(bob))]);

    const [foundAlice, foundBob] = await Promise.all([
      E.runPromise(repo.findByEmail(alice.email)),
      E.runPromise(repo.findByEmail(bob.email)),
    ]);

    expect(O.isSome(foundAlice)).toBe(true);
    expect(O.isSome(foundBob)).toBe(true);
    if (O.isSome(foundAlice) && O.isSome(foundBob)) {
      expect(foundAlice.value.id).not.toBe(foundBob.value.id);
    }
  });
});
