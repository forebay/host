import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerAnswer } from "../context/runtime-worker.js";
import { startUpdateTimer } from "./update-timer.js";

const HOUR = 3_600_000;

function answered(answer: WorkerAnswer): () => Promise<WorkerAnswer> {
  return vi.fn(() => Promise.resolve(answer));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startUpdateTimer", () => {
  it("calls updates.check at once and then on every hourly tick, reading no interval setting", async () => {
    const check = answered({ answer: { checked: [], fetched: [], refused: [], removed: [] } });
    const timer = startUpdateTimer({ hostId: "host", check, writeError: () => {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HOUR / 2);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HOUR / 2);
    expect(check).toHaveBeenCalledTimes(3);
    await timer.stop();
  });

  it("writes a failed check and every refused version to stderr with its fix", async () => {
    const written: string[] = [];
    const failing = startUpdateTimer({ hostId: "host", check: answered({ failed: "the worker died" }), writeError: (text) => written.push(text) });
    await vi.advanceTimersByTimeAsync(0);
    await failing.stop();
    const refusing = startUpdateTimer({
      hostId: "host",
      check: answered({ answer: { checked: [], fetched: [], refused: [{ id: "viewer@2.0.0", message: "the hash does not match", fix: "ask the publisher" }], removed: [] } }),
      writeError: (text) => written.push(text),
    });
    await vi.advanceTimersByTimeAsync(0);
    await refusing.stop();
    expect(written.join("")).toContain("the worker died");
    expect(written.join("")).toContain("viewer@2.0.0: the hash does not match\nfix: ask the publisher");
  });

  it.each([
    ["throws synchronously", () => {
      throw new Error("no worker could be started");
    }],
    ["rejects", () => Promise.reject(new Error("no worker could be started"))],
  ])("reports a check that %s, keeps ticking and stops cleanly", async (_how, failing) => {
    const written: string[] = [];
    const check = vi.fn(failing as () => Promise<WorkerAnswer>);
    const timer = startUpdateTimer({ hostId: "host", check, writeError: (text) => written.push(text) });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(check).toHaveBeenCalledTimes(2);
    expect(written.join("")).toContain("spisor could not check for updates of host: no worker could be started");
    await expect(timer.stop()).resolves.toBeUndefined();
  });
});
