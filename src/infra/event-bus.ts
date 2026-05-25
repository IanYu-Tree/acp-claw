import type { ControllerEvents, EventName } from '../types/events.js';

type Handler<T> = (payload: T) => void | Promise<void>;

/**
 * 类型安全的 EventBus
 */
export class EventBus {
  private handlers = new Map<string, Set<Handler<any>>>();

  on<K extends EventName>(
    event: K,
    handler: Handler<ControllerEvents[K]>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  emit<K extends EventName>(event: K, payload: ControllerEvents[K]): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    for (const handler of Array.from(handlers)) {
      try {
        const result = handler(payload);
        if (result && typeof result.catch === 'function') {
          result.catch((error: unknown) => {
            console.error(`[EventBus] Error in handler for "${event}":`, error);
          });
        }
      } catch (error) {
        console.error(`[EventBus] Error in handler for "${event}":`, error);
      }
    }
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
