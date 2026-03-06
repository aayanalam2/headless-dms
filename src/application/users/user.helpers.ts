import { Effect, Option, pipe } from "effect";
import { User, type SerializedUser } from "@domain/user/user.entity.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import { Email, type UserId } from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import { UserErrorTags } from "@domain/user/user.errors.ts";
import { UserWorkflowError, type UserWorkflowError as WorkflowError } from "./user-workflow.errors.ts";

// ---------------------------------------------------------------------------
// unavailable — uniform infra-error factory used by all repo wrappers.
// ---------------------------------------------------------------------------

export const unavailable =
  (op: string) =>
  (e: unknown): WorkflowError =>
    UserWorkflowError.unavailable(op, e);

// ---------------------------------------------------------------------------
// parseEmail
// Validates a raw string into a branded Email; fails with InvalidInput.
// Use this for registration where bad format is the caller's fault.
// ---------------------------------------------------------------------------

export function parseEmail(raw: string): Effect.Effect<Email, WorkflowError> {
  const result = Email.create(raw);
  return result.isOk()
    ? Effect.succeed(result.unwrap())
    : Effect.fail(UserWorkflowError.invalidInput("Invalid email address"));
}

// ---------------------------------------------------------------------------
// requireNoEmailConflict
// Asserts that no user already holds this email address.
// Fails with Duplicate if a row is found.
// ---------------------------------------------------------------------------

export function requireNoEmailConflict(
  repo: IUserRepository,
  email: Email,
  rawEmail: string,
): Effect.Effect<void, WorkflowError> {
  return pipe(
    repo.findByEmail(email),
    Effect.mapError(unavailable("repo.findByEmail")),
    Effect.flatMap((opt) =>
      Option.isSome(opt)
        ? Effect.fail(
            UserWorkflowError.duplicate(`An account with email '${rawEmail}' already exists`),
          )
        : Effect.void,
    ),
  );
}

// ---------------------------------------------------------------------------
// requireUserByEmail
// Fetches a user by email; maps absence to Unauthorized.
// The Unauthorized collapse is intentional — prevents user-enumeration attacks.
// ---------------------------------------------------------------------------

export function requireUserByEmail(
  repo: IUserRepository,
  email: Email,
): Effect.Effect<User, WorkflowError> {
  return pipe(
    repo.findByEmail(email),
    Effect.mapError(unavailable("repo.findByEmail")),
    Effect.flatMap((opt) =>
      Option.isNone(opt)
        ? Effect.fail(UserWorkflowError.unauthorized())
        : Effect.succeed(opt.value),
    ),
  );
}

// ---------------------------------------------------------------------------
// requireUser
// Fetches a user by ID; maps absence to NotFound with the provided label.
// ---------------------------------------------------------------------------

export function requireUser(
  repo: IUserRepository,
  userId: UserId,
  label: string,
): Effect.Effect<User, WorkflowError> {
  return pipe(
    repo.findById(userId),
    Effect.mapError(unavailable("repo.findById")),
    Effect.flatMap((opt) =>
      Option.isNone(opt)
        ? Effect.fail(UserWorkflowError.notFound(label))
        : Effect.succeed(opt.value),
    ),
  );
}

// ---------------------------------------------------------------------------
// assertAdmin
// Guard that the actor carries the Admin role; fails with Forbidden otherwise.
// ---------------------------------------------------------------------------

export function assertAdmin(actor: { readonly role: Role }): Effect.Effect<void, WorkflowError> {
  return actor.role !== Role.Admin
    ? Effect.fail(UserWorkflowError.forbidden("Only admins can change user roles"))
    : Effect.void;
}

// ---------------------------------------------------------------------------
// assertPasswordValid
// Verifies a plaintext password against a stored hash.
// Both format failures and wrong passwords collapse to Unauthorized — prevents
// distinguishing between "no account" and "wrong password" at the API layer.
// ---------------------------------------------------------------------------

export function assertPasswordValid(
  verifyFn: (plaintext: string, hash: string) => Promise<boolean>,
  plaintext: string,
  hash: string,
): Effect.Effect<void, WorkflowError> {
  return pipe(
    Effect.promise(() => verifyFn(plaintext, hash)),
    Effect.flatMap((valid) =>
      valid ? Effect.void : Effect.fail(UserWorkflowError.unauthorized()),
    ),
  );
}

// ---------------------------------------------------------------------------
// buildUser
// Wraps User.create (which decodes + validates all fields through the schema)
// and maps a decode failure to InvalidInput.
// ---------------------------------------------------------------------------

export function buildUser(input: SerializedUser): Effect.Effect<User, WorkflowError> {
  return pipe(
    User.create(input),
    Effect.mapError(() => UserWorkflowError.invalidInput("Failed to construct user entity")),
  );
}

// ---------------------------------------------------------------------------
// saveNewUser
// Persists a new User row; maps UserAlreadyExistsError to Duplicate and
// everything else to Unavailable.
// ---------------------------------------------------------------------------

export function saveNewUser(
  repo: IUserRepository,
  user: User,
): Effect.Effect<void, WorkflowError> {
  return pipe(
    repo.save(user),
    Effect.mapError((e) =>
      typeof e === "object" &&
      e !== null &&
      "_tag" in e &&
      (e as { _tag: string })._tag === UserErrorTags.UserAlreadyExists
        ? UserWorkflowError.duplicate((e as { message: string }).message)
        : UserWorkflowError.unavailable("repo.save", e),
    ),
  );
}

// ---------------------------------------------------------------------------
// updateUser
// Persists an updated User; maps UserNotFoundError to NotFound and
// everything else to Unavailable.
// ---------------------------------------------------------------------------

export function updateUser(
  repo: IUserRepository,
  user: User,
  label: string,
): Effect.Effect<void, WorkflowError> {
  return pipe(
    repo.update(user),
    Effect.mapError((e) =>
      typeof e === "object" &&
      e !== null &&
      "_tag" in e &&
      (e as { _tag: string })._tag === UserErrorTags.UserNotFound
        ? UserWorkflowError.notFound(label)
        : UserWorkflowError.unavailable("repo.update", e),
    ),
  );
}
