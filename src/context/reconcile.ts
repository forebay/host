import { Worker } from "node:worker_threads";
import type { RuntimeSource } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";
import type { ReconcileAnswer } from "./reconcile-worker.js";

const COMPILED_WORKER = new URL("./reconcile-worker.js", import.meta.url);
const STOPPED: ReconcileAnswer = { failed: "the host stopped before the reconcile finished" };

function stopOnAbort(worker: Worker, signal: AbortSignal | undefined, resolve: (answer: ReconcileAnswer) => void): void {
  if (signal === undefined) return;
  const stop = () => {
    resolve(STOPPED);
    void worker.terminate();
  };
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop, { once: true });
}

/**
 * Moves file-held secrets into the OS store on a worker thread, because a Secret Service prompt
 * blocks its caller. Never rejects. An aborted `signal` terminates the worker so it cannot outlive
 * its host.
 *
 * @implNote `workerEntry` is a seam: the source tree holds TypeScript, so a test points it at a
 * build of the worker, and the default is the sibling `.js` that `dist` carries.
 */
export function reconcileSecretsInBackground(
  source: RuntimeSource,
  places: HostPlaces,
  workerEntry: URL = COMPILED_WORKER,
  signal?: AbortSignal,
): Promise<ReconcileAnswer> {
  return new Promise((resolve) => {
    try {
      const worker = new Worker(workerEntry, { workerData: { source, places } });
      worker.once("message", resolve);
      worker.once("error", (cause) => resolve({ failed: cause.message }));
      worker.once("exit", (code) => resolve({ failed: `the reconcile worker exited with code ${code} before answering` }));
      stopOnAbort(worker, signal, resolve);
    } catch (cause) {
      resolve({ failed: cause instanceof Error ? cause.message : String(cause) });
    }
  });
}
