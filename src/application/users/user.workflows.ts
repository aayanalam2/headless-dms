import "reflect-metadata";
import { Effect, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import { Role } from "@domain/utils/enums.ts";
import { Email } from "@domain/utils/refined.types.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { AuthService } from "@infra/services/auth.service.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  RegisterUserCommandSchema,
  LoginCommandSchema,
  ChangeUserRoleCommandSchema,
  type RegisterUserCommandEncoded,
  type LoginCommandEncoded,
  type ChangeUserRoleCommandEncoded,
} from "./dtos/commands.dto.ts";
import { toUserDTO, toJwtClaims, type UserDTO, type JwtClaims } from "./dtos/user.dto.ts";
import {
  UserWorkflowError,
  type UserWorkflowError as WorkflowError,
} from "./user-workflow.errors.ts";
import {
  parseEmail,
  requireNoEmailConflict,
  requireUserByEmail,
  requireUser,
  assertAdmin,
  assertPasswordValid,
  buildUser,
  saveNewUser,
  updateUser,
} from "./user.helpers.ts";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type LoginResult = {
  readonly claims: JwtClaims;
  readonly user: UserDTO;
};

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

// Email format errors during login collapse to Unauthorized — never reveal
// to the caller whether the address was malformed or simply not registered.
function parseEmailForLogin(raw: string): Effect.Effect<Email, WorkflowError> {
  const result = Email.create(raw);
  return result.isOk()
    ? Effect.succeed(result.unwrap())
    : Effect.fail(UserWorkflowError.unauthorized());
}

// ---------------------------------------------------------------------------
// UserWorkflows — injectable application service
// ---------------------------------------------------------------------------

@injectable()
export class UserWorkflows {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepo: IUserRepository,
    @inject(TOKENS.AuthService) private readonly authService: AuthService,
  ) {}

  // -------------------------------------------------------------------------
  // register
  //
  // 1. Decode & validate raw input
  // 2. Parse + validate email format → branded Email
  // 3. Reject duplicate email address
  // 4. Hash password
  // 5. Build User entity via schema decode
  // 6. Persist
  // 7. Return UserDTO (passwordHash never included)
  // -------------------------------------------------------------------------

  register(raw: RegisterUserCommandEncoded): Effect.Effect<UserDTO, WorkflowError> {
    return pipe(
      decodeCommand(RegisterUserCommandSchema, raw, UserWorkflowError.invalidInput),
      Effect.flatMap((cmd) =>
        pipe(
          parseEmail(cmd.email),
          Effect.flatMap((email) =>
            pipe(
              requireNoEmailConflict(this.userRepo, email, cmd.email),
              Effect.flatMap(() => Effect.promise(() => this.authService.hash(cmd.password))),
              Effect.flatMap((passwordHash) =>
                buildUser({
                  id: crypto.randomUUID(),
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  email: cmd.email,
                  passwordHash,
                  role: cmd.role ?? Role.User,
                }),
              ),
              Effect.flatMap((user) =>
                pipe(
                  saveNewUser(this.userRepo, user),
                  Effect.as(toUserDTO(user)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // login
  //
  // 1. Decode raw input
  // 2. Parse email format  (→ Unauthorized on bad format, not InvalidInput)
  // 3. Find user by email  (→ Unauthorized if absent)
  // 4. Verify password     (→ Unauthorized if wrong)
  // 5. Return JwtClaims + UserDTO
  //
  // Security: all bad-credential branches collapse to a single Unauthorized
  // so callers cannot distinguish "no account" from "wrong password".
  // -------------------------------------------------------------------------

  login(raw: LoginCommandEncoded): Effect.Effect<LoginResult, WorkflowError> {
    return pipe(
      decodeCommand(LoginCommandSchema, raw, UserWorkflowError.invalidInput),
      Effect.flatMap((cmd) =>
        pipe(
          parseEmailForLogin(cmd.email),
          Effect.flatMap((email) => requireUserByEmail(this.userRepo, email)),
          Effect.flatMap((user) =>
            pipe(
              assertPasswordValid(
                (p, h) => this.authService.verify(p, h),
                cmd.password,
                user.passwordHash as string,
              ),
              Effect.as({ claims: toJwtClaims(user), user: toUserDTO(user) }),
            ),
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // changeRole
  //
  // 1. Decode & validate raw input
  // 2. Guard: actor must be Admin (→ Forbidden)
  // 3. Load target user by ID (→ NotFound)
  // 4. Apply role change via User.changeRole()
  // 5. Persist the updated user
  // 6. Return UserDTO with the new role
  // -------------------------------------------------------------------------

  changeRole(raw: ChangeUserRoleCommandEncoded): Effect.Effect<UserDTO, WorkflowError> {
    return pipe(
      decodeCommand(ChangeUserRoleCommandSchema, raw, UserWorkflowError.invalidInput),
      Effect.flatMap((cmd) =>
        pipe(
          assertAdmin(cmd.actor),
          Effect.flatMap(() =>
            requireUser(this.userRepo, cmd.targetUserId, `User '${cmd.targetUserId}'`),
          ),
          Effect.map((user) => user.changeRole(cmd.newRole, new Date())),
          Effect.flatMap((updated) =>
            pipe(
              updateUser(this.userRepo, updated, `User '${cmd.targetUserId}'`),
              Effect.as(toUserDTO(updated)),
            ),
          ),
        ),
      ),
    );
  }
}

