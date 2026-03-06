import { Effect as E, pipe } from "effect";
import { User, type SerializedUser } from "@domain/user/user.entity.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { Email, type UserId } from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import {
  UserWorkflowError,
  fromUserSaveError,
  fromUserUpdateError,
  type UserWorkflowError as WorkflowError,
} from "./user-workflow.errors.ts";
import {
  makeUnavailable,
  requireFound,
  requireAbsent,
  assertGuard,
} from "@application/shared/workflow.helpers.ts";

export const unavailable = makeUnavailable(UserWorkflowError.unavailable);

export function parseEmail(raw: string): E.Effect<Email, WorkflowError> {
  const result = Email.create(raw);
  return result.isOk()
    ? E.succeed(result.unwrap())
    : E.fail(UserWorkflowError.invalidInput("Invalid email address"));
}

export function requireNoEmailConflict(
  repo: IUserRepository,
  email: Email,
  rawEmail: string,
): E.Effect<void, WorkflowError> {
  return requireAbsent(repo.findByEmail(email), unavailable("repo.findByEmail"), () =>
    UserWorkflowError.duplicate(`An account with email '${rawEmail}' already exists`),
  );
}

// Unauthorized collapse is intentional — prevents user-enumeration attacks.
export function requireUserByEmail(
  repo: IUserRepository,
  email: Email,
): E.Effect<User, WorkflowError> {
  return requireFound(repo.findByEmail(email), unavailable("repo.findByEmail"), () =>
    UserWorkflowError.unauthorized(),
  );
}

export function requireUser(
  repo: IUserRepository,
  userId: UserId,
  label: string,
): E.Effect<User, WorkflowError> {
  return requireFound(repo.findById(userId), unavailable("repo.findById"), () =>
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
  verifyFn: (plaintext: string, hash: string) => Promise<boolean>,
  plaintext: string,
  hash: string,
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
    E.mapError((e) => fromUserSaveError("repo.user.save", e)),
  );
}

export function updateUser(
  repo: IUserRepository,
  user: User,
  label: string,
): E.Effect<void, WorkflowError> {
  return pipe(
    repo.update(user),
    E.mapError((e) => fromUserUpdateError("repo.user.update", label, e)),
  );
}
