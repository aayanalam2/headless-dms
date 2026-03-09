import { Effect as E, pipe, Schema as S } from "effect";
import { User, type SerializedUser } from "@domain/user/user.entity.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import {
  type Email,
  type HashedPassword,
  type UserId,
  StringToEmail,
} from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import {
  UserWorkflowError,
  fromUserSaveError,
  fromUserUpdateError,
  type UserWorkflowError as WorkflowError,
} from "./user-workflow.errors.ts";
import { requireFound, requireAbsent, assertGuard } from "@application/shared/workflow.helpers.ts";

export function parseEmail(raw: string): E.Effect<Email, WorkflowError> {
  return pipe(
    E.try(() => S.decodeSync(StringToEmail)(raw)),
    E.mapError(() => UserWorkflowError.invalidInput("Invalid email address")),
  );
}

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

export function assertAdmin(actor: { readonly role: Role }): E.Effect<void, WorkflowError> {
  return assertGuard(actor.role === Role.Admin, () =>
    UserWorkflowError.forbidden("Only admins can change user roles"),
  );
}

// Collapses to Unauthorized to prevent distinguishing "no account" vs "wrong password".
export function assertPasswordValid(
  verifyFn: (plaintext: string, hash: HashedPassword) => Promise<boolean>,
  plaintext: string,
  hash: HashedPassword,
): E.Effect<void, WorkflowError> {
  return pipe(
    E.promise(() => verifyFn(plaintext, hash)),
    E.flatMap((valid) => (valid ? E.void : E.fail(UserWorkflowError.unauthorized()))),
  );
}

export function buildUser(input: SerializedUser): E.Effect<User, WorkflowError> {
  return pipe(
    User.create(input),
    E.mapError(() => UserWorkflowError.invalidInput("Failed to construct user entity")),
  );
}

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
