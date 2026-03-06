import { describe, expect, it } from "bun:test";
import { Effect, Either } from "effect";
import { UserWorkflows } from "@application/users/user.workflows.ts";
import { UserWorkflowErrorTag } from "@application/users/user-workflow.errors.ts";
import type { ChangeUserRoleCommandEncoded } from "@application/users/dtos/commands.dto.ts";
import { Role } from "@domain/utils/enums.ts";
import { createInMemoryUserRepository } from "../../helpers/mocks.ts";
import { makeAdminUser, makeUser, makeUserId } from "../../domain/factories.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runWith(
  raw: ChangeUserRoleCommandEncoded,
  initialUsers: ReturnType<typeof makeUser>[],
) {
  const userRepo = createInMemoryUserRepository({ users: initialUsers });
  // AuthService is not used by changeRole — safe to omit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflows = new UserWorkflows(userRepo, null as any);
  return Effect.runPromise(Effect.either(workflows.changeRole(raw)));
}

const adminActor = { userId: makeUserId() as string, role: Role.Admin };
const userActor = { userId: makeUserId() as string, role: Role.User };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("changeUserRole workflow", () => {
  // -------------------------------------------------------------------------
  // Admin gate
  // -------------------------------------------------------------------------

  describe("admin gate", () => {
    it("fails with Forbidden when actor is not an admin", async () => {
      const target = makeUser({ role: Role.User });
      const result = await runWith(
        { actor: userActor, targetUserId: target.id as string, newRole: Role.Admin },
        [target],
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe(UserWorkflowErrorTag.Forbidden);
      }
    });

    it("succeeds when actor is an admin", async () => {
      const target = makeUser({ role: Role.User });
      const result = await runWith(
        { actor: adminActor, targetUserId: target.id as string, newRole: Role.Admin },
        [target],
      );

      expect(Either.isRight(result)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Role escalation
  // -------------------------------------------------------------------------

  describe("role escalation", () => {
    it("promotes a regular user to admin", async () => {
      const target = makeUser({ role: Role.User });
      const result = await runWith(
        { actor: adminActor, targetUserId: target.id as string, newRole: Role.Admin },
        [target],
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.role).toBe(Role.Admin);
        expect(result.right.id).toBe(target.id as string);
      }
    });

    it("strips admin privileges from an admin user", async () => {
      const target = makeAdminUser();
      const result = await runWith(
        { actor: adminActor, targetUserId: target.id as string, newRole: Role.User },
        [target],
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.role).toBe(Role.User);
      }
    });

    it("applies the same role idempotently without error", async () => {
      const target = makeUser({ role: Role.User });
      const result = await runWith(
        { actor: adminActor, targetUserId: target.id as string, newRole: Role.User },
        [target],
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.role).toBe(Role.User);
      }
    });

    it("preserves email and id in the returned DTO", async () => {
      const target = makeUser({ role: Role.User });
      const result = await runWith(
        { actor: adminActor, targetUserId: target.id as string, newRole: Role.Admin },
        [target],
      );

      expect(Either.isRight(result)).toBe(true);
      if (Either.isRight(result)) {
        expect(result.right.id).toBe(target.id as string);
        expect(result.right.email).toBe(target.email as string);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Not-found handling
  // -------------------------------------------------------------------------

  describe("not-found handling", () => {
    it("fails with NotFound when the target user does not exist", async () => {
      const missingId = makeUserId() as string;
      const result = await runWith(
        { actor: adminActor, targetUserId: missingId, newRole: Role.Admin },
        [],
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe(UserWorkflowErrorTag.NotFound);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Invalid input
  // -------------------------------------------------------------------------

  describe("invalid input", () => {
    it("fails with InvalidInput when targetUserId is not a valid UUID", async () => {
      const result = await runWith(
        { actor: adminActor, targetUserId: "not-a-uuid", newRole: Role.Admin },
        [],
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe(UserWorkflowErrorTag.InvalidInput);
      }
    });
  });

  // -------------------------------------------------------------------------
  // passwordHash never exposed
  // -------------------------------------------------------------------------

  it("does not include passwordHash in the returned DTO", async () => {
    const target = makeUser({ role: Role.User });
    const result = await runWith(
      { actor: adminActor, targetUserId: target.id as string, newRole: Role.Admin },
      [target],
    );

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect("passwordHash" in result.right).toBe(false);
    }
  });
});
