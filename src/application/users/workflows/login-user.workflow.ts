import { Effect, Option, pipe } from "effect";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { Email } from "@domain/utils/refined.types.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  LoginCommandSchema,
  type LoginCommandEncoded,
} from "../dtos/commands.dto.ts";
import { toUserDTO, toJwtClaims, type UserDTO, type JwtClaims } from "../dtos/user.dto.ts";
import {
  UserWorkflowError,
  type UserWorkflowError as WorkflowError,
} from "../user-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LoginUserDeps = {
  readonly userRepo: IUserRepository;
  /** Async password verification function. */
  readonly verifyPassword: (plaintext: string, hash: string) => Promise<boolean>;
};

export type LoginResult = {
  readonly claims: JwtClaims;
  readonly user: UserDTO;
};

// ---------------------------------------------------------------------------
// Workflow — linear pipe
//
// 1. Decode raw input
// 2. Validate email format → branded Email
// 3. Find user by email
// 4. Verify password
// 5. Return JwtClaims + UserDTO
//
// Security: all failure branches for bad-credential scenarios collapse into
// a single `Unauthorized` error — this prevents user-enumeration attacks.
// ---------------------------------------------------------------------------

export function loginUser(
  deps: LoginUserDeps,
  raw: LoginCommandEncoded,
): Effect.Effect<LoginResult, WorkflowError> {
  return pipe(
    decodeCommand(LoginCommandSchema, raw, UserWorkflowError.invalidInput),
    Effect.flatMap((cmd) =>
      Effect.gen(function* () {
        // ── 1. Validate email format ────────────────────────────────────────
        const emailResult = Email.create(cmd.email);
        if (!emailResult.isOk()) {
          // Return Unauthorized — never reveal why login failed to the caller
          return yield* Effect.fail(UserWorkflowError.unauthorized());
        }

        // ── 2. Look up user by email ────────────────────────────────────────
        const userOpt = yield* pipe(
          deps.userRepo.findByEmail(emailResult.unwrap()),
          Effect.mapError((e) =>
            UserWorkflowError.unavailable("repo.findByEmail", e),
          ),
        );
        if (Option.isNone(userOpt)) {
          return yield* Effect.fail(UserWorkflowError.unauthorized());
        }
        const user = userOpt.value;

        // ── 3. Verify password ──────────────────────────────────────────────
        const valid = yield* Effect.promise(() =>
          deps.verifyPassword(cmd.password, user.passwordHash as string),
        );
        if (!valid) {
          return yield* Effect.fail(UserWorkflowError.unauthorized());
        }

        return { claims: toJwtClaims(user), user: toUserDTO(user) };
      }),
    ),
  );
}
