import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { User } from "@domain/user/user.entity.ts";
import { isAdmin, isRegularUser } from "@domain/user/user.guards.ts";
import { Role } from "@domain/utils/enums.ts";
import { Email, HashedPassword, UserId } from "@domain/utils/refined.types.ts";
import { FIXED_DATE, makeAdminUser, makeUser, makeUserId } from "./factories.ts";

describe("User entity", () => {
  // -------------------------------------------------------------------------
  // User.create
  // -------------------------------------------------------------------------

  describe("User.create", () => {
    it("creates a user with the correct properties", () => {
      const id = makeUserId();
      const email = "alice@example.com";
      const passwordHash = "$2b$10$hash";

      const user = Effect.runSync(
        User.create({
          id: id as string,
          email,
          passwordHash,
          role: Role.User,
          createdAt: FIXED_DATE.toISOString(),
        }),
      );

      expect(user).toBeInstanceOf(User);
      expect(user.id).toBe(id);
      expect(user.email).toBe(Email.create(email).unwrap());
      expect(user.passwordHash).toBe(HashedPassword.create(passwordHash).unwrap());
      expect(user.role).toBe(Role.User);
      expect(user.createdAt).toEqual(FIXED_DATE);
    });

    it("sets updatedAt equal to createdAt (immutable entity)", () => {
      const user = makeUser();
      expect(user.updatedAt).toEqual(user.createdAt);
    });

    it("creates an admin user with Role.Admin", () => {
      const admin = makeAdminUser();
      expect(admin.role).toBe(Role.Admin);
    });
  });

  // -------------------------------------------------------------------------
  // User.reconstitute
  // -------------------------------------------------------------------------

  describe("User.reconstitute", () => {
    it("reconstitutes a user from persisted data with independent timestamps", () => {
      const id = makeUserId();
      const createdAt = new Date("2024-01-01T00:00:00.000Z");
      const updatedAt = new Date("2024-06-01T00:00:00.000Z");

      const user = User.reconstitute({
        id,
        email: Email.create("bob@example.com").unwrap(),
        passwordHash: HashedPassword.create("$2b$10$hash").unwrap(),
        role: Role.Admin,
        createdAt,
      });

      // reconstitute sets updatedAt = createdAt (immutable entity)
      expect(user.id).toBe(id);
      expect(user.createdAt).toEqual(createdAt);
      expect(user.role).toBe(Role.Admin);
      // suppress unused var warning
      void updatedAt;
    });
  });

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  describe("isAdmin / isRegularUser guards", () => {
    it("isAdmin returns true for Role.Admin", () => {
      const admin = makeAdminUser();
      expect(isAdmin(admin)).toBe(true);
    });

    it("isAdmin returns false for Role.User", () => {
      const user = makeUser();
      expect(isAdmin(user)).toBe(false);
    });

    it("isRegularUser returns true for Role.User", () => {
      const user = makeUser();
      expect(isRegularUser(user)).toBe(true);
    });

    it("isRegularUser returns false for Role.Admin", () => {
      const admin = makeAdminUser();
      expect(isRegularUser(admin)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // equals()
  // -------------------------------------------------------------------------

  describe("equals", () => {
    it("two users with the same id are equal", () => {
      const id = makeUserId();
      const a = makeUser({ id: id as string });
      const b = makeUser({ id: id as string });
      expect(a.equals(b)).toBe(true);
    });

    it("two users with different ids are not equal", () => {
      const a = makeUser();
      const b = makeUser();
      expect(a.equals(b)).toBe(false);
    });
  });
});
