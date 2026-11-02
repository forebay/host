import type { RuntimeEvents } from "@weivel/typescript/engine";

type Listener = (payload: unknown) => void;

export type ListenerFailureReport = (cause: unknown) => void;

function writeToStderr(cause: unknown): void {
  process.stderr.write(`an event listener threw: ${cause instanceof Error ? cause.message : String(cause)}\n`);
}

function deliver(listener: Listener, payload: unknown, report: ListenerFailureReport): void {
  try {
    listener(payload);
  } catch (cause) {
    report(cause);
  }
}

/**
 * One in-process bus every plugin of a host publishes to and subscribes on.
 *
 * @implNote A listener that throws is reported and skipped, so one broken subscriber neither
 * silences the rest nor fails the plugin that published.
 */
export function eventBus(report: ListenerFailureReport = writeToStderr): RuntimeEvents {
  const listeners = new Map<string, Set<Listener>>();
  return {
    publish: (topic, payload) => {
      for (const listener of [...(listeners.get(topic) ?? [])]) deliver(listener, payload, report);
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
