import { Effect as E, Schema as S, pipe } from "effect";

export function decodeCommand<A, I, E>(
  schema: S.Schema<A, I>,
  raw: unknown,
  onError: (message: string) => E,
): E.Effect<A, E> {
  return pipe(
    S.decodeUnknown(schema, { onExcessProperty: "ignore" })(raw),
    E.mapError((e) => onError(String(e.message))),
  );
}

export { pipe };
