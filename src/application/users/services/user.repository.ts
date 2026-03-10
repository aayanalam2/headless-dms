import { Effect as E, pipe } from "effect";
import { User } from "@domain/user/user.entity.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import type { Email, UserId } from "@domain/utils/refined.types.ts";
import { requireFound, requireAbsent } from "@application/shared/workflow.helpers.ts";
import {
  UserWorkflowError,
  fromUserSaveError,
  fromUserUpdateError,
  type UserWorkflowError as WorkflowError,
} from "../user-workflow.errors.ts";

// ---------------------------------------------------------------------------
// User lookups
// ---------------------------------------------------------------------------

export function requireNoEmailConflict(
  repo: IUserRepository,
  email: Email,
  rawEmail: string,
): E.Effect<void, WorkflowError> {
  return requireAbsent(repo.findByEmail(email), UserWorkflowError.unavailable, () =>
    UserWorkflowError.duplicate(`An account with email '${rawEmail}' already exists`),
  );
}

// Unauthorized collapse is intentional — prevents user-enumeration attacks.
export function requireUserByEmail(
  repo: IUserRepository,
  email: Email,
): E.Effect<User, WorkflowError> {
  return requireFound(repo.findByEmail(email), UserWorkflowError.unavailable, () =>
    UserWorkflowError.unauthorized(),
  );
}

export function requireUser(
  repo: IUserRepository,
  userId: UserId,
  label: string,
): E.Effect<User, WorkflowError> {
  return requireFound(repo.findById(userId), UserWorkflowError.unavailable, () =>
    UserWorkflowError.notFound(label),
  );
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

export function saveNewUser(repo: IUserRepository, user: User): E.Effect<void, WorkflowError> {
  return pipe(
    repo.save(user),
    E.mapError((e) => fromUserSaveError(e)),
  );
}

export function updateUser(
  repo: IUserRepository,
  user: User,
  label: string,
): E.Effect<void, WorkflowError> {
  return pipe(
    repo.update(user),
    E.mapError((e) => fromUserUpdateError(label, e)),
  );
}
