import type { OverlayEvent } from './types';

export type Listener = (event: OverlayEvent) => void;

export interface Bus {
  emit(event: OverlayEvent): void;
  on(listener: Listener): () => void;
}

export function createBus(): Bus {
  const listeners = new Set<Listener>();

  return {
    emit(event) {
      for (const listener of listeners) {
        // One broken listener must not take the others down.
        try {
          listener(event);
        } catch {
          /* ignored on purpose */
        }
      }
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
