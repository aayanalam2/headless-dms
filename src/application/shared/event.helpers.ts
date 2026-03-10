import { Effect as E } from "effect";
import { eventBus } from "@infra/event-bus.ts";

/**
 * Factory that returns a typed event emitter wrapped in `E.sync`.
 *
 * @example
 * export const emitDocumentUploaded = makeEmit<DocumentUploadedEvent>(DocumentEvent.Uploaded);
 */
export function makeEmit<Payload>(key: string) {
  return (event: Payload): E.Effect<void, never> =>
    E.sync(() => eventBus.emit(key as never, event as never));
}
