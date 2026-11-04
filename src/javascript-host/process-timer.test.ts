import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_MILLISECONDS, PRUNE_FAILURES_BEFORE_EXIT, startProcessTimer } from "./process-timer.js";

function failingPrune() {
  return {
    recordRun: vi.fn(() => ({ record: "record" })),
    prune: vi.fn((): { exit: boolean } => {
      throw new Error("the holders file is unreadable");
    }),
    removeRuns: vi.fn(() => ({})),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startProcessTimer", () => {
  it("leaves a held host once prune has failed the allowed number of times in a row, reporting each failure", () => {
    const processes = failingPrune();
    const failures: string[] = [];
    const onUnheld = vi.fn();
    const timer = startProcessTimer({ runtime: { processes }, state: "state", hostId: "host", run: {}, record: "record", held: true, onUnheld, onFailure: (message) => failures.push(message) });
    vi.advanceTimersByTime(CHECK_MILLISECONDS * (PRUNE_FAILURES_BEFORE_EXIT - 2));
    expect(onUnheld).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CHECK_MILLISECONDS);
    expect(onUnheld).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(PRUNE_FAILURES_BEFORE_EXIT);
    expect(failures[0]).toContain("the holders file is unreadable");
    vi.advanceTimersByTime(CHECK_MILLISECONDS * 3);
    expect(onUnheld).toHaveBeenCalledTimes(1);
    timer.stop();
  });

  it("starts counting again after a turn that succeeds", () => {
    const processes = failingPrune();
    let calls = 0;
    processes.prune.mockImplementation(() => {
      calls += 1;
      if (calls % PRUNE_FAILURES_BEFORE_EXIT === 0) return { exit: false };
      throw new Error("flaky");
    });
    const onUnheld = vi.fn();
    const timer = startProcessTimer({ runtime: { processes }, state: "state", hostId: "host", run: {}, record: "record", held: true, onUnheld, onFailure: () => {} });
    vi.advanceTimersByTime(CHECK_MILLISECONDS * PRUNE_FAILURES_BEFORE_EXIT * 3);
    expect(onUnheld).not.toHaveBeenCalled();
    timer.stop();
  });
});
