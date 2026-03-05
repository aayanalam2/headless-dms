import type { DocumentEventMap } from "@domain/events/document.events.ts";

// ---------------------------------------------------------------------------
// Minimal typed in-process event bus.
//
// Placed in the infra layer because it is a runtime mechanism (singleton
// instance) shared by the application workflows (emit) and the infra audit
// listener (subscribe).
// ---------------------------------------------------------------------------

type Handler<T> = (payload: T) => void;

class EventBus<TMap extends Record<string, unknown>> {
  private readonly handlers = new Map<string, Handler<unknown>[]>();

  on<K extends keyof TMap & string>(event: K, handler: Handler<TMap[K]>): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(event, [...existing, handler as Handler<unknown>]);
  }

  emit<K extends keyof TMap & string>(event: K, payload: TMap[K]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

export const eventBus = new EventBus<DocumentEventMap>();
