import { Effect as E, pipe, Schema as S } from "effect";
import { User, type SerializedUser } from "@domain/user/user.entity.ts";
import { type Email, type HashedPassword, StringToEmail } from "@domain/utils/refined.types.ts";
import { UserWorkflowError, type UserWorkflowError as WorkflowError } from "../user-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Email parsing
// ---------------------------------------------------------------------------

export function parseEmail(raw: string): E.Effect<Email, WorkflowError> {
  return pipe(
    E.try(() => S.decodeSync(StringToEmail)(raw)),
    E.mapError(() => UserWorkflowError.invalidInput("Invalid email address")),
  );
}

// ---------------------------------------------------------------------------
// Entity construction
// ---------------------------------------------------------------------------

export function buildUser(input: SerializedUser): E.Effect<User, WorkflowError> {
  return pipe(
    User.create(input),
    E.mapError(() => UserWorkflowError.invalidInput("Failed to construct user entity")),
  );
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

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
