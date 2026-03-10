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

/**
 * Factory that binds an error constructor and returns a domain-specific `decode` function.
 *
 * @example
 * export const decode = makeDecoder(MyWorkflowError.invalidInput);
 * // decode(SomeSchema, rawInput)  →  Effect<A, MyWorkflowError>
 */
export function makeDecoder<Err>(onError: (message: string) => Err) {
  return <A, I>(schema: S.Schema<A, I>, raw: unknown): E.Effect<A, Err> =>
    decodeCommand(schema, raw, onError);
}

export { pipe };
