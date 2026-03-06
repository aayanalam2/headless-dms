import type { Option as O } from "effect";
import type { User } from "@domain/user/user.entity.ts";
import type { UserId, Email } from "@domain/utils/refined.types.ts";
import type { UserAlreadyExistsError, UserNotFoundError } from "@domain/user/user.errors.ts";
import type { RepositoryEffect } from "@domain/utils/repository.types.ts";

// ---------------------------------------------------------------------------
// IUserRepository — persistence port for User aggregates
//
// ---------------------------------------------------------------------------

export interface IUserRepository {
  /**
   * Find a user by their primary key.
   *
   */
  findById(id: UserId): RepositoryEffect<O.Option<User>>;

  /**
   * Find a user by their email address (login identifier).
   *
   */
  findByEmail(email: Email): RepositoryEffect<O.Option<User>>;

  /**
   * Persist a new user for the first time.
   */
  save(user: User): RepositoryEffect<void, UserAlreadyExistsError>;
  /**
   * Persist changes to an existing user.
   */
  update(user: User): RepositoryEffect<void, UserNotFoundError>;
}
