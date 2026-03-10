import { Effect as E, Option as O, pipe } from "effect";
import type { Role } from "@domain/utils/enums.ts";
import { Role as RoleEnum } from "@domain/utils/enums.ts";

/**
 * Factory that binds an 'unavailable' constructor and returns a `liftRepo` function.
 * The returned function maps any effect's error to an Unavailable error — intended for
 * repository and storage calls.
 *
 * @example
 * const liftRepo = makeLiftRepo(MyError.unavailable);
 * liftRepo(repo.findById(id))
 */
export function makeLiftRepo<Err>(
  ctor: (cause: unknown) => Err,
): <A, F>(eff: E.Effect<A, F>) => E.Effect<A, Err> {
  return (eff) =>
    pipe(
      eff,
      E.mapError((e) => ctor(e)),
    );
}

/**
 * Factory that binds a 'conflict' constructor and returns a `liftConflict` function.
 * The returned function maps a domain Effect whose error carries a `message` field
 * to a Conflict error.
 *
 * @example
 * const liftConflict = makeLiftConflict(MyError.conflict);
 * liftConflict(entity.someMethod())
 */
export function makeLiftConflict<Err>(
  ctor: (message: string) => Err,
): <A>(eff: E.Effect<A, { readonly message: string }>) => E.Effect<A, Err> {
  return (eff) =>
    pipe(
      eff,
      E.mapError((e) => ctor(e.message)),
    );
}

export function assertOrFail<T, E>(condition: boolean, value: T, onFail: () => E): E.Effect<T, E> {
  return condition ? E.succeed(value) : E.fail(onFail());
}

export function assertGuard<E>(condition: boolean, onFail: () => E): E.Effect<void, E> {
  return condition ? E.void : E.fail(onFail());
}

/**
 * Unwraps an Option-returning repository fetch into an Effect that fails with a
 * domain error when no row is found.
 *
 * @param fetch      - the Effect to execute (must produce `O.Option<T>`)
 * @param mapError   - maps any infrastructure error to the workflow error type
 * @param onNotFound - produces the not-found workflow error
 */
export function requireFound<T, Err>(
  fetch: E.Effect<O.Option<T>, unknown>,
  mapError: (e: unknown) => Err,
  onNotFound: () => Err,
): E.Effect<T, Err> {
  return pipe(
    fetch,
    E.mapError(mapError),
    E.flatMap((opt) => (O.isNone(opt) ? E.fail(onNotFound()) : E.succeed(opt.value))),
  );
}

/**
 * Asserts that an Option-returning repository fetch produces no row. Fails with
 * a conflict / duplicate error when a row IS found.
 *
 * @param fetch    - the Effect to execute (must produce `O.Option<unknown>`)
 * @param mapError - maps any infrastructure error to the workflow error type
 * @param onFound  - produces the conflict workflow error
 */
export function requireAbsent<Err>(
  fetch: E.Effect<O.Option<unknown>, unknown>,
  mapError: (e: unknown) => Err,
  onFound: () => Err,
): E.Effect<void, Err> {
  return pipe(
    fetch,
    E.mapError(mapError),
    E.flatMap((opt) => (O.isSome(opt) ? E.fail(onFound()) : E.void)),
  );
}

/**
 * Factory that returns a context-passing admin guard.
 *
 * The returned function asserts `ctx.actor.role === Role.Admin`, failing with
 * the error produced by `onFail` when the check fails.
 *
 * @example
 * export const assertAdminActor = makeRequireAdmin(
 *   () => MyError.forbidden("Admin only"),
 * );
 */
export function makeRequireAdmin<Err>(onFail: () => Err) {
  return <T extends { actor: { readonly role: Role } }>(ctx: T): E.Effect<T, Err> =>
    E.as(assertGuard(ctx.actor.role === RoleEnum.Admin, onFail), ctx);
}
