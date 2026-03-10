import { Effect as E, pipe, Schema as S } from "effect";
import { User } from "@domain/user/user.entity.ts";
import type { IUserRepository } from "@domain/user/user.repository.ts";
import {
  type Email,
  type HashedPassword,
  StringToEmail,
} from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import { makeRequireAdmin } from "@application/shared/workflow.helpers.ts";
import {
  UserWorkflowError,
  type UserWorkflowError as WorkflowError,
} from "../user-workflow.errors.ts";
import { parseEmail, assertPasswordValid, buildUser } from "../services/user.auth.ts";
import {
  requireNoEmailConflict,
  requireUserByEmail,
  requireUser,
  saveNewUser,
  updateUser,
} from "../services/user.repository.ts";
import type { RegisterUserCommand, LoginCommand, ChangeUserRoleCommand } from "../dtos/user.dto.ts";

// ---------------------------------------------------------------------------
// Named pipeline context types
// ---------------------------------------------------------------------------

/** Decoded RegisterUserCommand — email, password, optional role. */
export type RegisterCmd = RegisterUserCommand;
/** RegisterCmd after the email has been parsed to a branded type. */
export type RegisterCtx = RegisterCmd & { readonly parsedEmail: Email };
/** RegisterCtx after the password has been hashed. */
export type RegisterCtxWithHash = RegisterCtx & { readonly passwordHash: HashedPassword };
/** RegisterCtxWithHash after the User entity has been constructed. */
export type RegisterCtxWithUser = RegisterCtxWithHash & { readonly user: User };

/** Decoded LoginCommand — email and password as plain strings. */
export type LoginCmd = LoginCommand;
/** LoginCmd after the email has been parsed to a branded type. */
export type LoginCtxWithEmail = LoginCmd & { readonly parsedEmail: Email };
/** LoginCtxWithEmail after the User entity has been loaded from the repository. */
export type LoginCtxWithUser = LoginCtxWithEmail & { readonly user: User };

/** Decoded ChangeUserRoleCommand. */
export type ChangeRoleCmd = ChangeUserRoleCommand;
/** ChangeRoleCmd after the target User entity has been loaded. */
export type ChangeRoleCmdWithUser = ChangeRoleCmd & { readonly user: User };
/** ChangeRoleCmdWithUser after the role change has been applied. */
export type ChangeRoleCmdWithUpdated = ChangeRoleCmdWithUser & { readonly updated: User };

// ---------------------------------------------------------------------------
// Registration pipeline steps
// ---------------------------------------------------------------------------

/** Parses `ctx.email` to a typed Email and merges it as `parsedEmail`. */
export function parseRegistrationEmail(ctx: RegisterCmd): E.Effect<RegisterCtx, WorkflowError> {
  return E.map(parseEmail(ctx.email), (parsedEmail) => ({ ...ctx, parsedEmail }));
}

/** Checks that no account with `ctx.parsedEmail` already exists. */
export function checkEmailAvailable(
  repo: IUserRepository,
): (ctx: RegisterCtx) => E.Effect<void, WorkflowError> {
  return (ctx) => requireNoEmailConflict(repo, ctx.parsedEmail, ctx.email);
}

/** Hashes `ctx.password` and merges it as `passwordHash`. */
export function hashRegistrationPassword(
  hashFn: (password: string) => Promise<HashedPassword>,
): (ctx: RegisterCtx) => E.Effect<RegisterCtxWithHash, WorkflowError> {
  return (ctx) =>
    E.map(
      E.promise(() => hashFn(ctx.password)),
      (passwordHash) => ({ ...ctx, passwordHash }),
    );
}

/** Constructs a new User entity and merges it as `user`. */
export function buildRegistrationUser(
  ctx: RegisterCtxWithHash,
): E.Effect<RegisterCtxWithUser, WorkflowError> {
  return E.map(
    buildUser({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      email: ctx.email,
      passwordHash: ctx.passwordHash,
      role: ctx.role ?? Role.User,
    }),
    (user) => ({ ...ctx, user }),
  );
}

/** Persists the new user to the repository. */
export function saveRegistrationUser(
  repo: IUserRepository,
): (ctx: RegisterCtxWithUser) => E.Effect<void, WorkflowError> {
  return (ctx) => saveNewUser(repo, ctx.user);
}

// ---------------------------------------------------------------------------
// Login pipeline steps
// ---------------------------------------------------------------------------

/**
 * Parses `ctx.email` for login, collapsing any parse error to Unauthorized
 * (never reveals whether the address was malformed or not registered).
 */
export function parseLoginEmail(ctx: LoginCmd): E.Effect<LoginCtxWithEmail, WorkflowError> {
  return pipe(
    E.try(() => S.decodeSync(StringToEmail)(ctx.email)),
    E.map((parsedEmail) => ({ ...ctx, parsedEmail })),
    E.mapError(() => UserWorkflowError.unauthorized()),
  );
}

/** Loads the user by email and merges them as `user`. */
export function findUserByEmail(
  repo: IUserRepository,
): (ctx: LoginCtxWithEmail) => E.Effect<LoginCtxWithUser, WorkflowError> {
  return (ctx) => E.map(requireUserByEmail(repo, ctx.parsedEmail), (user) => ({ ...ctx, user }));
}

/** Verifies `ctx.password` against `ctx.user.passwordHash`. */
export function verifyPasswordCtx(
  verifyFn: (plaintext: string, hash: HashedPassword) => Promise<boolean>,
): (ctx: LoginCtxWithUser) => E.Effect<void, WorkflowError> {
  return (ctx) => assertPasswordValid(verifyFn, ctx.password, ctx.user.passwordHash);
}

// ---------------------------------------------------------------------------
// Change-role pipeline steps
// ---------------------------------------------------------------------------

/** Asserts that `ctx.actor` has the Admin role. */
export const assertAdminActor = makeRequireAdmin(() =>
  UserWorkflowError.forbidden("Only admins can change user roles"),
);

/** Loads the target user by `ctx.targetUserId` and merges them as `user`. */
export function requireTargetUser(
  repo: IUserRepository,
): (ctx: ChangeRoleCmd) => E.Effect<ChangeRoleCmdWithUser, WorkflowError> {
  return (ctx) =>
    E.map(requireUser(repo, ctx.targetUserId, `User '${ctx.targetUserId}'`), (user) => ({
      ...ctx,
      user,
    }));
}

/** Pure sync step — applies the new role and merges the result as `updated`. */
export function applyRoleChange(ctx: ChangeRoleCmdWithUser): ChangeRoleCmdWithUpdated {
  return { ...ctx, updated: ctx.user.changeRole(ctx.newRole, new Date()) };
}

/** Persists the updated user to the repository. */
export function saveRoleChange(
  repo: IUserRepository,
): (ctx: ChangeRoleCmdWithUpdated) => E.Effect<void, WorkflowError> {
  return (ctx) => updateUser(repo, ctx.updated, `User '${ctx.targetUserId}'`);
}
