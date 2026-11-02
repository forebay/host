import type { RuntimeEvents } from "@weivel/typescript/engine";

export const ACTIVITY_TOPIC = "activity";

/** What a plugin's context publishes on {@link ACTIVITY_TOPIC}: which plugin, what happened, and its detail. */
export interface ActivityRecord {
  source: string;
  kind: string;
  detail: Record<string, unknown>;
}

export type ActivityPublisher = (kind: string, detail: Record<string, unknown>) => void;

/** Nothing persists these records; whoever subscribes to the bus decides what they are worth. */
export function activityPublisher(bus: RuntimeEvents, source: string): ActivityPublisher {
  return (kind, detail) => {
    const record: ActivityRecord = { source, kind, detail };
    bus.publish(ACTIVITY_TOPIC, record);
  };
}
