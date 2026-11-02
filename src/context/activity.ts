import type { RuntimeEvents } from "@weivel/typescript/engine";

export const ACTIVITY_TOPIC = "activity";

export type ActivityPublisher = (kind: string, detail: Record<string, unknown>) => void;

/** Nothing persists these records; whoever subscribes to the bus decides what they are worth. */
export function activityPublisher(bus: RuntimeEvents, source: string): ActivityPublisher {
  return (kind, detail) => bus.publish(ACTIVITY_TOPIC, { source, kind, detail });
}
