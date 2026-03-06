import { Effect as E, pipe } from "effect";
import { Role } from "@domain/utils/enums.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  RegisterUserCommandSchema,
  type RegisterUserCommandEncoded,
  toUserDTO,
  type UserDTO,
} from "../dtos/user.dto.ts";
import {
  UserWorkflowError,
  type UserWorkflowError as WorkflowError,
} from "../user-workflow.errors.ts";
import { parseEmail, requireNoEmailConflict, buildUser, saveNewUser } from "../user.helpers.ts";

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
// 2. Parse + validate email format → branded Email
// 3. Reject duplicate email address
// 4. Hash password
// 5. Build User entity via schema decode
// 6. Persist
// 7. Return UserDTO (passwordHash never included)
// ---------------------------------------------------------------------------

export function registerUser(
  deps: RegisterUserDeps,
  raw: RegisterUserCommandEncoded,
): E.Effect<UserDTO, WorkflowError> {
  return pipe(
    decodeCommand(RegisterUserCommandSchema, raw, UserWorkflowError.invalidInput),
    E.flatMap((cmd) =>
      pipe(
        parseEmail(cmd.email),
        E.flatMap((email) =>
          pipe(
            requireNoEmailConflict(deps.userRepo, email, cmd.email),
            E.flatMap(() => E.promise(() => deps.hashPassword(cmd.password))),
            E.flatMap((passwordHash) =>
              buildUser({
                id: crypto.randomUUID(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                email: cmd.email,
                passwordHash,
                role: cmd.role ?? Role.User,
              }),
            ),
            E.flatMap((user) => pipe(saveNewUser(deps.userRepo, user), E.as(toUserDTO(user)))),
          ),
        ),
      ),
    ),
  );
}
