import { Worker } from "node:worker_threads";
import type { RuntimeSource } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";
import type { ReconcileAnswer } from "./reconcile-worker.js";

const COMPILED_WORKER = new URL("./reconcile-worker.js", import.meta.url);
const STOPPED: ReconcileAnswer = { failed: "the host stopped before the reconcile finished" };

type Settle = (answer: ReconcileAnswer) => void;

/** Resolves once, and stops listening to `signal` as it does, so a settled reconcile holds nothing of its host's signal. */
function settlerFor(resolve: Settle, signal: AbortSignal | undefined, onAbort: () => void): Settle {
  return (answer) => {
    signal?.removeEventListener("abort", onAbort);
    resolve(answer);
  };
}

function startWorker(source: RuntimeSource, places: HostPlaces, workerEntry: URL, signal: AbortSignal | undefined, resolve: Settle): void {
  let worker: Worker | undefined;
  const onAbort = () => {
    settle(STOPPED);
    void worker?.terminate();
  };
  const settle = settlerFor(resolve, signal, onAbort);
  try {
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    worker = new Worker(workerEntry, { workerData: { source, places } });
    worker.once("message", settle);
    worker.once("error", (cause) => settle({ failed: cause.message }));
    worker.once("exit", (code) => settle({ failed: `the reconcile worker exited with code ${code} before answering` }));
  } catch (cause) {
    settle({ failed: cause instanceof Error ? cause.message : String(cause) });
  }
}

/**
 * Runs the reconcile worker found at `workerEntry`. Never rejects. An aborted `signal` terminates
 * the worker so it cannot outlive its host.
 *
 * @implNote A seam kept out of the package entry: the source tree holds TypeScript, so a test
 * points `workerEntry` at a build of the worker.
 */
export function runReconcileWorker(source: RuntimeSource, places: HostPlaces, workerEntry: URL, signal?: AbortSignal): Promise<ReconcileAnswer> {
  return new Promise((resolve) => startWorker(source, places, workerEntry, signal, resolve));
}

/**
 * Moves file-held secrets into the OS store on a worker thread, because a Secret Service prompt
 * blocks its caller. Never rejects. An aborted `signal` terminates the worker so it cannot outlive
 * its host.
 */
export function reconcileSecretsInBackground(source: RuntimeSource, places: HostPlaces, signal?: AbortSignal): Promise<ReconcileAnswer> {
  return runReconcileWorker(source, places, COMPILED_WORKER, signal);
}
