import { parentPort, workerData } from "node:worker_threads";
import { openRuntime } from "../runtime/open.js";
import type { RuntimeSource } from "../runtime/open.js";
import type { HostPlaces } from "./places.js";

export interface ReconcileRequest {
  source: RuntimeSource;
  places: HostPlaces;
  /** Test seam: the worker waits this long before reconciling, so the caller's thread is provably free meanwhile. */
  delayMilliseconds?: number;
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

function pause(milliseconds: number): void {
  if (milliseconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function run(request: ReconcileRequest): void {
  try {
    pause(request.delayMilliseconds ?? 0);
    parentPort?.postMessage(reconcile(request));
  } catch (cause) {
    parentPort?.postMessage({ failed: cause instanceof Error ? cause.message : String(cause) });
  }
}

if (parentPort !== null) run(workerData as ReconcileRequest);
