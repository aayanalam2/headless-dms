import { Effect, Schema as S, pipe } from "effect";

// ---------------------------------------------------------------------------
// decodeCommand
//
// Validates a raw input value against an Effect Schema at the workflow
// boundary.  The caller supplies `onError` — a function that converts a
// parse-error message string into the caller's own error type — so this
// helper stays generic and does not leak any particular error vocabulary.
//
// Usage:
//   pipe(
//     decodeCommand(MyCommandSchema, raw, MyWorkflowError.invalidInput),
//     Effect.flatMap((cmd) => doWork(deps, cmd)),
//   )
// ---------------------------------------------------------------------------

export function decodeCommand<A, I, E>(
  schema: S.Schema<A, I>,
  raw: unknown,
  onError: (message: string) => E,
): Effect.Effect<A, E> {
  return pipe(
    S.decodeUnknown(schema, { onExcessProperty: "ignore" })(raw),
    Effect.mapError((e) => onError(String(e.message))),
  );
}

// Re-export pipe for convenience so workflow files have one fewer import
export { pipe };
