import { Worker } from "node:worker_threads";
import type { RuntimeSource } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";
import type { ReconcileAnswer } from "./reconcile-worker.js";

const COMPILED_WORKER = new URL("./reconcile-worker.js", import.meta.url);

export interface ReconcileOptions {
  workerEntry?: URL;
  delayMilliseconds?: number;
}

/**
 * Moves file-held secrets into the OS store on a worker thread, because a Secret Service prompt
 * blocks its caller. Never rejects.
 *
 * @implNote `workerEntry` is a seam: the source tree holds TypeScript, so a test points it at a
 * build of the worker, and the default is the sibling `.js` that `dist` carries.
 */
export function reconcileSecretsInBackground(
  source: RuntimeSource,
  places: HostPlaces,
  options: ReconcileOptions = {},
): Promise<ReconcileAnswer> {
  const { workerEntry = COMPILED_WORKER, delayMilliseconds } = options;
  return new Promise((resolve) => {
    try {
      const worker = new Worker(workerEntry, { workerData: { source, places, delayMilliseconds } });
      worker.once("message", resolve);
      worker.once("error", (cause) => resolve({ failed: cause.message }));
      worker.once("exit", (code) => resolve({ failed: `the reconcile worker exited with code ${code} before answering` }));
    } catch (cause) {
      resolve({ failed: cause instanceof Error ? cause.message : String(cause) });
    }
  });
}
