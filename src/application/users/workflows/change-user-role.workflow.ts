import { Effect, Option, pipe } from "effect";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { Role } from "@domain/utils/enums.ts";
import { UserId } from "@domain/utils/refined.types.ts";
import { UserErrorTags } from "@domain/user/user.errors.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  ChangeUserRoleCommandSchema,
  type ChangeUserRoleCommandEncoded,
} from "../dtos/commands.dto.ts";
import { toUserDTO, type UserDTO } from "../dtos/user.dto.ts";
import {
  UserWorkflowError,
  type UserWorkflowError as WorkflowError,
} from "../user-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChangeUserRoleDeps = {
  readonly userRepo: IUserRepository;
};

// ---------------------------------------------------------------------------
// Workflow — linear pipe
//
// 1. Decode & validate raw input
// 2. Guard: actor must be an admin (→ Forbidden)
// 3. Validate targetUserId format
// 4. Load target user (→ NotFound)
// 5. Apply role change via User.changeRole()
// 6. Persist the updated user
// 7. Return UserDTO with the new role
// ---------------------------------------------------------------------------

export function changeUserRole(
  deps: ChangeUserRoleDeps,
  raw: ChangeUserRoleCommandEncoded,
): Effect.Effect<UserDTO, WorkflowError> {
  return pipe(
    decodeCommand(ChangeUserRoleCommandSchema, raw, UserWorkflowError.invalidInput),
    Effect.flatMap((cmd) =>
      Effect.gen(function* () {
        // ── 1. Admin gate ──────────────────────────────────────────────────
        if (cmd.actor.role !== Role.Admin) {
          return yield* Effect.fail(
            UserWorkflowError.forbidden("Only admins can change user roles"),
          );
        }

        // ── 2. Validate target user ID format ──────────────────────────────
        const userIdResult = UserId.create(cmd.targetUserId);
        if (!userIdResult.isOk()) {
          return yield* Effect.fail(
            UserWorkflowError.invalidInput(`Invalid target user ID: '${cmd.targetUserId}'`),
          );
        }
        const targetUserId = userIdResult.unwrap();

        // ── 3. Find target user ────────────────────────────────────────────
        const userOpt = yield* pipe(
          deps.userRepo.findById(targetUserId),
          Effect.mapError((e) => UserWorkflowError.unavailable("repo.findById", e)),
        );
        if (Option.isNone(userOpt)) {
          return yield* Effect.fail(UserWorkflowError.notFound(`User '${cmd.targetUserId}'`));
        }
        const user = userOpt.value;

        // ── 4. Apply role change ───────────────────────────────────────────
        const updated = user.changeRole(cmd.newRole, new Date());

        // ── 5. Persist ─────────────────────────────────────────────────────
        yield* pipe(
          deps.userRepo.update(updated),
          Effect.mapError((e) => {
            if (
              typeof e === "object" &&
              e !== null &&
              "_tag" in e &&
              (e as { _tag: UserErrorTags })._tag === UserErrorTags.UserNotFound
            ) {
              return UserWorkflowError.notFound(`User '${cmd.targetUserId}'`);
            }
            return UserWorkflowError.unavailable("repo.update", e);
          }),
        );

        return toUserDTO(updated);
      }),
    ),
  );
}
