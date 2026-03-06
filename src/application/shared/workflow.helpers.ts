import { Effect, Option, pipe } from "effect";

// ---------------------------------------------------------------------------
// makeUnavailable
// Lifts an error constructor of shape (op, cause) => E into a curried
// infra-error factory  op => cause => E  suitable for Effect.mapError.
// ---------------------------------------------------------------------------

export function makeUnavailable<E>(
  ctor: (op: string, cause: unknown) => E,
): (op: string) => (e: unknown) => E {
  return (op) => (e) => ctor(op, e);
}

// ---------------------------------------------------------------------------
// requireFound
// Wraps a repo lookup that returns Option<T>.
// - Infra errors are mapped through `mapError`.
// - An absent row (None) fails with `onNotFound()`.
// ---------------------------------------------------------------------------

export function requireFound<T, E>(
  fetch: Effect.Effect<Option.Option<T>, unknown>,
  mapError: (e: unknown) => E,
  onNotFound: () => E,
): Effect.Effect<T, E> {
  return pipe(
    fetch,
    Effect.mapError(mapError),
    Effect.flatMap((opt) =>
      Option.isNone(opt) ? Effect.fail(onNotFound()) : Effect.succeed(opt.value),
    ),
  );
}

// ---------------------------------------------------------------------------
// requireAbsent
// Wraps a repo lookup that returns Option<T>.
// - Infra errors are mapped through `mapError`.
// - A present row (Some) fails with `onFound()`.
// - Absence succeeds with void.
// ---------------------------------------------------------------------------

export function requireAbsent<E>(
  fetch: Effect.Effect<Option.Option<unknown>, unknown>,
  mapError: (e: unknown) => E,
  onFound: () => E,
): Effect.Effect<void, E> {
  return pipe(
    fetch,
    Effect.mapError(mapError),
    Effect.flatMap((opt) => (Option.isSome(opt) ? Effect.fail(onFound()) : Effect.void)),
  );
}

// ---------------------------------------------------------------------------
// assertOrFail
// Evaluates a boolean condition and either succeeds with `value` or fails
// with the error produced by `onFail`.  Use when the guard needs to pass a
// value downstream (e.g. returning the document after an ownership check).
// ---------------------------------------------------------------------------

export function assertOrFail<T, E>(
  condition: boolean,
  value: T,
  onFail: () => E,
): Effect.Effect<T, E> {
  return condition ? Effect.succeed(value) : Effect.fail(onFail());
}

// ---------------------------------------------------------------------------
// assertGuard
// Void specialisation of assertOrFail.  Use for role-only gates that do not
// need to return a value (e.g. assertAdmin, assertAdminOnly).
// ---------------------------------------------------------------------------

export function assertGuard<E>(condition: boolean, onFail: () => E): Effect.Effect<void, E> {
  return condition ? Effect.void : Effect.fail(onFail());
}
