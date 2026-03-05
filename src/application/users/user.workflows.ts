import { inject, injectable } from "tsyringe";
import type { Effect } from "effect";
import { TOKENS } from "@infra/di/tokens.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { AuthService } from "@infra/services/auth.service.ts";
import { registerUser } from "./workflows/register-user.workflow.ts";
import { loginUser } from "./workflows/login-user.workflow.ts";
import type { RegisterUserCommandEncoded } from "./dtos/commands.dto.ts";
import type { LoginCommandEncoded } from "./dtos/commands.dto.ts";
import type { UserWorkflowError } from "./user-workflow.errors.ts";
import type { UserDTO } from "./dtos/user.dto.ts";
import type { LoginResult } from "./workflows/login-user.workflow.ts";

// ---------------------------------------------------------------------------
// UserWorkflows — injectable application service wrapping all user workflow
// functions.  Controllers receive this class via DI instead of building raw
// deps objects manually.
// ---------------------------------------------------------------------------

@injectable()
export class UserWorkflows {
  constructor(
    @inject(TOKENS.UserRepository) private readonly userRepo: IUserRepository,
    @inject(TOKENS.AuthService) private readonly authService: AuthService,
  ) {}

  register(raw: RegisterUserCommandEncoded): Effect.Effect<UserDTO, UserWorkflowError> {
    return registerUser(
      {
        userRepo: this.userRepo,
        hashPassword: (p) => this.authService.hash(p),
      },
      raw,
    );
  }

  login(raw: LoginCommandEncoded): Effect.Effect<LoginResult, UserWorkflowError> {
    return loginUser(
      {
        userRepo: this.userRepo,
        verifyPassword: (p, h) => this.authService.verify(p, h),
      },
      raw,
    );
  }
}
