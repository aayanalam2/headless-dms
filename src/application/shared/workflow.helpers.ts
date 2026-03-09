import { Effect as E, Option as O, pipe } from "effect";

export function makeUnavailable<E>(
  ctor: (op: string, cause: unknown) => E,
): (op: string) => (e: unknown) => E {
  return (op) => (e) => ctor(op, e);
}

export function requireFound<T, E>(
  fetch: E.Effect<O.Option<T>, unknown>,
  mapError: (e: unknown) => E,
  onNotFound: () => E,
): E.Effect<T, E> {
  return pipe(
    fetch,
    E.mapError(mapError),
    E.flatMap((opt) => (O.isNone(opt) ? E.fail(onNotFound()) : E.succeed(opt.value))),
  );
}

export function requireAbsent<E>(
  fetch: E.Effect<O.Option<unknown>, unknown>,
  mapError: (e: unknown) => E,
  onFound: () => E,
): E.Effect<void, E> {
  return pipe(
    fetch,
    E.mapError(mapError),
    E.flatMap((opt) => (O.isSome(opt) ? E.fail(onFound()) : E.void)),
  );
}

/**
 * Factory that binds an 'unavailable' constructor and returns a `liftRepo` function.
 * The returned function maps any effect's error to an Unavailable error — intended for
 * repository and storage calls.
 *
 * @example
 * const liftRepo = makeLiftRepo(MyError.unavailable);
 * liftRepo("repo.findById", repo.findById(id))
 */
export function makeLiftRepo<Err>(
  ctor: (op: string, cause: unknown) => Err,
): <A, F>(op: string, eff: E.Effect<A, F>) => E.Effect<A, Err> {
  return (op, eff) =>
    pipe(
      eff,
      E.mapError((e) => ctor(op, e)),
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
