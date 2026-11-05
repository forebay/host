import type { RuntimeSource } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";
import { callInWorker, COMPILED_WORKER } from "./worker-call.js";

export type ReconcileAnswer = { moved: number } | { failed: string };

const STOPPED = "the host stopped before the reconcile finished";

/**
 * Runs the reconcile on the worker found at `workerEntry`. Never rejects.
 *
 * @implNote A seam kept out of the package entry: the source tree holds TypeScript, so a test
 * points `workerEntry` at a build of the worker.
 */
export async function runReconcileWorker(source: RuntimeSource, places: HostPlaces, workerEntry: URL, signal?: AbortSignal): Promise<ReconcileAnswer> {
  const answered = await callInWorker({ source, service: "secrets", function: "reconcile", argument: { places } }, workerEntry, STOPPED, signal);
  return "failed" in answered ? answered : { moved: (answered.answer as { moved: number }).moved };
}

/**
 * Moves file-held secrets into the OS store on a worker thread, because a Secret Service prompt
 * blocks its caller. Never rejects. An aborted `signal` terminates the worker so it cannot outlive
 * its host.
 */
export function reconcileSecretsInBackground(source: RuntimeSource, places: HostPlaces, signal?: AbortSignal): Promise<ReconcileAnswer> {
  return runReconcileWorker(source, places, COMPILED_WORKER, signal);
}
