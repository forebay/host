import type { ReconcileAnswer } from "./context/reconcile.js";

export interface ReconcileTracker {
  outcome(): ReconcileAnswer | null;
  stop(): Promise<void>;
}

/** Holds a background reconcile's answer once it arrives, and aborts it on `stop`. */
export function trackReconcile(start: (signal: AbortSignal) => Promise<ReconcileAnswer>): ReconcileTracker {
  const controller = new AbortController();
  let answer: ReconcileAnswer | null = null;
  const settled = start(controller.signal).then((given) => {
    answer = given;
  });
  return {
    outcome: () => answer,
    stop: async () => {
      controller.abort();
      await settled;
    },
  };
}
