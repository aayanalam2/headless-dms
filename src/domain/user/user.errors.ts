import { DomainError } from "@domain/utils/base.errors.ts";
import type { UserId } from "@domain/utils/refined.types.ts";

export enum UserErrorTags {
  UserNotFound = "UserNotFound",
  UserAlreadyExists = "UserAlreadyExists",
}

/** No user row matched the requested ID. */
export class UserNotFoundError extends DomainError {
  readonly _tag = UserErrorTags.UserNotFound as const;

  constructor(readonly userId: UserId) {
    super(`User '${userId}' was not found`);
  }
}

/** A registration attempt would create a duplicate email address. */
export class UserAlreadyExistsError extends DomainError {
  readonly _tag = UserErrorTags.UserAlreadyExists as const;

  constructor(readonly email: string) {
    super(`A user with email '${email}' already exists`);
  }
}

/** Union of every error that can originate within the user sub-domain. */
export type UserDomainError = UserNotFoundError | UserAlreadyExistsError;
