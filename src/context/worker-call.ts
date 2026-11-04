import { Worker } from "node:worker_threads";
import type { WorkerAnswer, WorkerCall } from "./runtime-worker.js";

/** Where the bundled worker sits: beside the module that starts it, in the bundle and in `dist` alike. */
export const COMPILED_WORKER = new URL("./runtime-worker.js", import.meta.url);

type Settle = (answer: WorkerAnswer) => void;

/** Resolves once, and stops listening to `signal` as it does, so a settled call holds nothing of its caller's signal. */
function settlerFor(resolve: Settle, signal: AbortSignal | undefined, onAbort: () => void): Settle {
  return (answer) => {
    signal?.removeEventListener("abort", onAbort);
    resolve(answer);
  };
}

function startWorker(request: WorkerCall, workerEntry: URL, stopped: string, signal: AbortSignal | undefined, resolve: Settle): void {
  let worker: Worker | undefined;
  const onAbort = () => {
    settle({ failed: stopped });
    void worker?.terminate();
  };
  const settle = settlerFor(resolve, signal, onAbort);
  try {
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    worker = new Worker(workerEntry, { workerData: request });
    worker.once("message", settle);
    worker.once("error", (cause) => settle({ failed: cause.message }));
    worker.once("exit", (code) => settle({ failed: `the runtime worker exited with code ${code} before answering` }));
  } catch (cause) {
    settle({ failed: cause instanceof Error ? cause.message : String(cause) });
  }
}

/**
 * Calls one runtime function on a worker thread, for a call that blocks its caller: a Secret
 * Service prompt, or a catalog check that waits on the network. Never rejects; an aborted `signal`
 * terminates the worker and answers `stopped`.
 */
export function callInWorker(request: WorkerCall, workerEntry: URL, stopped: string, signal?: AbortSignal): Promise<WorkerAnswer> {
  return new Promise((resolve) => startWorker(request, workerEntry, stopped, signal, resolve));
}
