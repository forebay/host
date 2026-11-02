import { parentPort, workerData } from "node:worker_threads";
import { openRuntime } from "../runtime/open.js";
import type { RuntimeSource } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";

export interface ReconcileRequest {
  source: RuntimeSource;
  places: HostPlaces;
}

export type ReconcileAnswer = { moved: number } | { failed: string };

function reconcile({ source, places }: ReconcileRequest): ReconcileAnswer {
  const runtime = openRuntime(source);
  try {
    return { moved: runtime.secrets.reconcile({ places }).moved };
  } finally {
    runtime.close();
  }
}

function run(request: ReconcileRequest): void {
  try {
    parentPort?.postMessage(reconcile(request));
  } catch (cause) {
    parentPort?.postMessage({ failed: cause instanceof Error ? cause.message : String(cause) });
  }
}

if (parentPort !== null) run(workerData as ReconcileRequest);
