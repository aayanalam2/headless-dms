import "reflect-metadata";
import { Effect as E, pipe, Schema as S } from "effect";
import { inject, injectable } from "tsyringe";
import { Role } from "@domain/utils/enums.ts";
import { type Email, StringToEmail } from "@domain/utils/refined.types.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { AuthService } from "@infra/services/auth.service.ts";
import { TOKENS } from "@infra/di/tokens.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  RegisterUserCommandSchema,
  LoginCommandSchema,
  ChangeUserRoleCommandSchema,
  toUserDTO,
  toJwtClaims,
  type RegisterUserCommandEncoded,
  type LoginCommandEncoded,
  type ChangeUserRoleCommandEncoded,
  type UserDTO,
  type JwtClaims,
} from "./dtos/user.dto.ts";
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

export type LoginResult = {
  readonly claims: JwtClaims;
  readonly user: UserDTO;
};

// Email format errors during login collapse to Unauthorized — never reveal
// to the caller whether the address was malformed or simply not registered.
function parseEmailForLogin(raw: string): E.Effect<Email, WorkflowError> {
  return pipe(
    E.try(() => S.decodeSync(StringToEmail)(raw)),
    E.mapError(() => UserWorkflowError.unauthorized()),
  );
}

@injectable()
export class UserWorkflows {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepo: IUserRepository,
    @inject(TOKENS.AuthService) private readonly authService: AuthService,
  ) {}

  register(raw: RegisterUserCommandEncoded): E.Effect<UserDTO, WorkflowError> {
    return pipe(
      decodeCommand(RegisterUserCommandSchema, raw, UserWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          parseEmail(cmd.email),
          E.flatMap((email) =>
            pipe(
              requireNoEmailConflict(this.userRepo, email, cmd.email),
              E.flatMap(() => E.promise(() => this.authService.hash(cmd.password))),
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
              E.flatMap((user) => pipe(saveNewUser(this.userRepo, user), E.as(toUserDTO(user)))),
            ),
          ),
        ),
      ),
    );
  }

  // Security: all bad-credential branches collapse to Unauthorized.
  login(raw: LoginCommandEncoded): E.Effect<LoginResult, WorkflowError> {
    return pipe(
      decodeCommand(LoginCommandSchema, raw, UserWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          parseEmailForLogin(cmd.email),
          E.flatMap((email) => requireUserByEmail(this.userRepo, email)),
          E.flatMap((user) =>
            pipe(
              assertPasswordValid(
                (p, h) => this.authService.verify(p, h),
                cmd.password,
                user.passwordHash,
              ),
              E.as({ claims: toJwtClaims(user), user: toUserDTO(user) }),
            ),
          ),
        ),
      ),
    );
  }

  changeRole(raw: ChangeUserRoleCommandEncoded): E.Effect<UserDTO, WorkflowError> {
    return pipe(
      decodeCommand(ChangeUserRoleCommandSchema, raw, UserWorkflowError.invalidInput),
      E.flatMap((cmd) =>
        pipe(
          assertAdmin(cmd.actor),
          E.flatMap(() =>
            requireUser(this.userRepo, cmd.targetUserId, `User '${cmd.targetUserId}'`),
          ),
          E.map((user) => user.changeRole(cmd.newRole, new Date())),
          E.flatMap((updated) =>
            pipe(
              updateUser(this.userRepo, updated, `User '${cmd.targetUserId}'`),
              E.as(toUserDTO(updated)),
            ),
          ),
        ),
      ),
    );
  }
}
