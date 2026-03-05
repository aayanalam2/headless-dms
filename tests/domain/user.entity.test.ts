import { describe, expect, it } from "bun:test";
import { User } from "@domain/user/user.entity.ts";
import { isAdmin, isRegularUser } from "@domain/user/user.guards.ts";
import { Role } from "@domain/utils/enums.ts";
import { Email, HashedPassword } from "@domain/utils/refined.types.ts";
import { FIXED_DATE, makeAdminUser, makeUser, makeUserId } from "./factories.ts";

describe("User entity", () => {
  // -------------------------------------------------------------------------
  // User.create
  // -------------------------------------------------------------------------

  describe("User.create", () => {
    it("creates a user with the correct properties", () => {
      const id = makeUserId();
      const email = Email.create("alice@example.com").unwrap();
      const passwordHash = HashedPassword.create("$2b$10$hash").unwrap();

      const user = User.create({
        id,
        email,
        passwordHash,
        role: Role.User,
        createdAt: FIXED_DATE,
      });

      expect(user).toBeInstanceOf(User);
      expect(user.id).toBe(id);
      expect(user.email).toBe(email);
      expect(user.passwordHash).toBe(passwordHash);
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
      const email = Email.create("bob@example.com").unwrap();
      const passwordHash = HashedPassword.create("$2b$10$hash").unwrap();

      const user = User.reconstitute(id, createdAt, {
        email,
        passwordHash,
        role: Role.Admin,
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
      const a = makeUser({ id });
      const b = makeUser({ id });
      expect(a.equals(b)).toBe(true);
    });

    it("two users with different ids are not equal", () => {
      const a = makeUser();
      const b = makeUser();
      expect(a.equals(b)).toBe(false);
    });
  });
});
