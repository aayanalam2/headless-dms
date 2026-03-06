import { Effect, Option, pipe } from "effect";
import { User } from "@domain/user/user.entity.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { UserErrorTags } from "@domain/user/user.errors.ts";
import { Email, HashedPassword, UserId } from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  RegisterUserCommandSchema,
  type RegisterUserCommandEncoded,
} from "../dtos/commands.dto.ts";
import { toUserDTO, type UserDTO } from "../dtos/user.dto.ts";
import {
  UserWorkflowError,
  type UserWorkflowError as WorkflowError,
} from "../user-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegisterUserDeps = {
  readonly userRepo: IUserRepository;
  /** Async password hashing function (bcrypt / argon2 / test stub). */
  readonly hashPassword: (plaintext: string) => Promise<string>;
};

// ---------------------------------------------------------------------------
// Workflow — linear pipe
//
// 1. Decode & validate raw input
// 2. Validate email format → branded Email
// 3. Check for existing account (duplicate guard)
// 4. Hash password
// 5. Construct User entity
// 6. Persist
// 7. Return UserDTO (passwordHash never included)
// ---------------------------------------------------------------------------

export function registerUser(
  deps: RegisterUserDeps,
  raw: RegisterUserCommandEncoded,
): Effect.Effect<UserDTO, WorkflowError> {
  return pipe(
    decodeCommand(RegisterUserCommandSchema, raw, UserWorkflowError.invalidInput),
    Effect.flatMap((cmd) =>
      Effect.gen(function* () {
        // ── 1. Validate email as branded type ──────────────────────────────
        const emailResult = Email.create(cmd.email);
        if (!emailResult.isOk()) {
          return yield* Effect.fail(UserWorkflowError.invalidInput("Invalid email address"));
        }
        const email = emailResult.unwrap();

        // ── 2. Duplicate check ─────────────────────────────────────────────
        const existing = yield* pipe(
          deps.userRepo.findByEmail(email),
          Effect.mapError((e) => UserWorkflowError.unavailable("repo.findByEmail", e)),
        );
        if (Option.isSome(existing)) {
          return yield* Effect.fail(
            UserWorkflowError.duplicate(`An account with email '${cmd.email}' already exists`),
          );
        }

        // ── 3. Hash password ───────────────────────────────────────────────
        const raw_hash = yield* Effect.promise(() => deps.hashPassword(cmd.password));

        // ── 4. Construct entity ────────────────────────────────────────────
        const user = yield* pipe(
          User.create({
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            email: cmd.email,
            passwordHash: raw_hash,
            role: cmd.role ?? Role.User,
          }),
          Effect.mapError(() => UserWorkflowError.invalidInput("Failed to construct user entity")),
        );

        // ── 5. Persist (save maps UserAlreadyExistsError → Duplicate) ──────
        yield* pipe(
          deps.userRepo.save(user),
          Effect.mapError((e) => {
            if ("_tag" in e && e._tag === UserErrorTags.UserAlreadyExists) {
              return UserWorkflowError.duplicate(e.message);
            }
            return UserWorkflowError.unavailable("repo.save", e);
          }),
        );

        return toUserDTO(user);
      }),
    ),
  );
}
