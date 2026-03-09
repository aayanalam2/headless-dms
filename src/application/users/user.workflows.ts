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

const decode = <A, I>(schema: S.Schema<A, I>, raw: unknown) =>
  decodeCommand(schema, raw, UserWorkflowError.invalidInput);

@injectable()
export class UserWorkflows {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepo: IUserRepository,
    @inject(TOKENS.AuthService) private readonly authService: AuthService,
  ) {}

  register(raw: RegisterUserCommandEncoded): E.Effect<UserDTO, WorkflowError> {
    return pipe(
      decode(RegisterUserCommandSchema, raw),
      E.flatMap((cmd) =>
        pipe(
          parseEmail(cmd.email),
          E.flatMap((email) => requireNoEmailConflict(this.userRepo, email, cmd.email)),
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
          E.tap((user) => saveNewUser(this.userRepo, user)),
          E.map(toUserDTO),
        ),
      ),
    );
  }

  // Security: all bad-credential branches collapse to Unauthorized.
  login(raw: LoginCommandEncoded): E.Effect<LoginResult, WorkflowError> {
    return pipe(
      decode(LoginCommandSchema, raw),
      E.flatMap((cmd) =>
        pipe(
          parseEmailForLogin(cmd.email),
          E.flatMap((email) => requireUserByEmail(this.userRepo, email)),
          E.tap((user) =>
            assertPasswordValid(
              (p, h) => this.authService.verify(p, h),
              cmd.password,
              user.passwordHash,
            ),
          ),
          E.map((user) => ({ claims: toJwtClaims(user), user: toUserDTO(user) })),
        ),
      ),
    );
  }

  changeRole(raw: ChangeUserRoleCommandEncoded): E.Effect<UserDTO, WorkflowError> {
    return pipe(
      decode(ChangeUserRoleCommandSchema, raw),
      E.flatMap((cmd) =>
        pipe(
          assertAdmin(cmd.actor),
          E.flatMap(() =>
            requireUser(this.userRepo, cmd.targetUserId, `User '${cmd.targetUserId}'`),
          ),
          E.map((user) => user.changeRole(cmd.newRole, new Date())),
          E.tap((updated) => updateUser(this.userRepo, updated, `User '${cmd.targetUserId}'`)),
          E.map(toUserDTO),
        ),
      ),
    );
  }
}
