import type { RuntimeEvents } from "@weivel/typescript/engine";

type Listener = (payload: unknown) => void;

/** One in-process bus every plugin of a host publishes to and subscribes on. */
export function eventBus(): RuntimeEvents {
  const listeners = new Map<string, Set<Listener>>();
  return {
    publish: (topic, payload) => {
      for (const listener of [...(listeners.get(topic) ?? [])]) listener(payload);
    },
    subscribe: (topic, listener) => {
      const subscribed = listeners.get(topic) ?? new Set<Listener>();
      listeners.set(topic, subscribed.add(listener));
      return () => {
        subscribed.delete(listener);
      };
    },
  };
}
