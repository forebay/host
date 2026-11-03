import { afterEach, describe, expect, it } from "vitest";
import { exitStopper } from "./session-host.js";

const unhandled: unknown[] = [];
const recordUnhandled = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off("unhandledRejection", recordUnhandled);
  unhandled.splice(0);
});

describe("the stop a session host runs as its process exits", () => {
  it("writes a stop that fails to stderr with its fix, leaving no unhandled rejection in the application's process", async () => {
    process.on("unhandledRejection", recordUnhandled);
    const written: string[] = [];
    const onExit = exitStopper(() => Promise.reject(new Error("the runtime is already closed")), (text) => written.push(text));

    onExit();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(unhandled).toEqual([]);
    expect(written).toEqual([expect.stringContaining("the runtime is already closed")]);
    expect(written[0]).toContain("fix: ");
  });
});
