import "reflect-metadata";
import { Effect as E, pipe } from "effect";
import { inject, injectable } from "tsyringe";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { AuthService } from "@infra/services/auth.service.ts";
import { TOKENS } from "@infra/di/tokens.ts";
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
} from "../dtos/user.dto.ts";
import { type UserWorkflowError as WorkflowError } from "../user-workflow.errors.ts";
import {
  parseRegistrationEmail,
  checkEmailAvailable,
  hashRegistrationPassword,
  buildRegistrationUser,
  saveRegistrationUser,
  parseLoginEmail,
  findUserByEmail,
  verifyPasswordCtx,
  assertAdminActor,
  requireTargetUser,
  applyRoleChange,
  saveRoleChange,
} from "../steps/user.context.steps.ts";
import { decode, type LoginResult } from "../steps/user.workflow.steps.ts";

@injectable()
export class UserWorkflows {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepo: IUserRepository,
    @inject(TOKENS.AuthService) private readonly authService: AuthService,
  ) {}

  register(raw: RegisterUserCommandEncoded): E.Effect<UserDTO, WorkflowError> {
    return pipe(
      decode(RegisterUserCommandSchema, raw),
      E.flatMap(parseRegistrationEmail),
      E.tap(checkEmailAvailable(this.userRepo)),
      E.flatMap(hashRegistrationPassword((p) => this.authService.hash(p))),
      E.flatMap(buildRegistrationUser),
      E.tap(saveRegistrationUser(this.userRepo)),
      E.map(({ user }) => toUserDTO(user)),
    );
  }

  // Security: all bad-credential branches collapse to Unauthorized.
  login(raw: LoginCommandEncoded): E.Effect<LoginResult, WorkflowError> {
    return pipe(
      decode(LoginCommandSchema, raw),
      E.flatMap(parseLoginEmail),
      E.flatMap(findUserByEmail(this.userRepo)),
      E.tap(verifyPasswordCtx((p, h) => this.authService.verify(p, h))),
      E.map(({ user }) => ({ claims: toJwtClaims(user), user: toUserDTO(user) })),
    );
  }

  changeRole(raw: ChangeUserRoleCommandEncoded): E.Effect<UserDTO, WorkflowError> {
    return pipe(
      decode(ChangeUserRoleCommandSchema, raw),
      E.flatMap(assertAdminActor),
      E.flatMap(requireTargetUser(this.userRepo)),
      E.map(applyRoleChange),
      E.tap(saveRoleChange(this.userRepo)),
      E.map(({ updated }) => toUserDTO(updated)),
    );
  }
}
