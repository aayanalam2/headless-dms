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

export function assertOrFail<T, E>(condition: boolean, value: T, onFail: () => E): E.Effect<T, E> {
  return condition ? E.succeed(value) : E.fail(onFail());
}

export function assertGuard<E>(condition: boolean, onFail: () => E): E.Effect<void, E> {
  return condition ? E.void : E.fail(onFail());
}
