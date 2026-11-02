import { describe, expect, it } from "vitest";
import { eventBus } from "./event-bus.js";

describe("eventBus", () => {
  it("still reaches every listener when one throws, and never throws into the publisher", () => {
    const reported: unknown[] = [];
    const bus = eventBus((cause) => reported.push(cause));
    const heard: unknown[] = [];
    bus.subscribe("topic", () => {
      throw new Error("a listener broke");
    });
    bus.subscribe("topic", (payload) => heard.push(payload));
    expect(() => bus.publish("topic", 1)).not.toThrow();
    expect(heard).toEqual([1]);
    expect(reported).toEqual([new Error("a listener broke")]);
  });

  it("stops reaching a listener once it unsubscribes", () => {
    const bus = eventBus();
    const heard: unknown[] = [];
    const unsubscribe = bus.subscribe("topic", (payload) => heard.push(payload));
    bus.publish("topic", 1);
    unsubscribe();
    bus.publish("topic", 2);
    expect(heard).toEqual([1]);
  });
});
