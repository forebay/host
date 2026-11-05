import { parentPort, workerData } from "node:worker_threads";
import { openRuntime } from "../runtime/open.js";
import type { RuntimeSource } from "../runtime/open.js";

/** One runtime function to call off the main thread, and the argument to call it with. */
export interface WorkerCall {
  source: RuntimeSource;
  service: "secrets" | "updates";
  function: "reconcile" | "check";
  argument: unknown;
}

export type WorkerAnswer = { answer: unknown } | { failed: string };

function call(request: WorkerCall): WorkerAnswer {
  const runtime = openRuntime(request.source);
  try {
    const service = runtime[request.service] as unknown as Record<string, (argument: unknown) => unknown>;
    return { answer: (service[request.function] as (argument: unknown) => unknown).call(service, request.argument) };
  } finally {
    runtime.close();
  }
}

function run(request: WorkerCall): void {
  try {
    parentPort?.postMessage(call(request));
  } catch (cause) {
    parentPort?.postMessage({ failed: cause instanceof Error ? cause.message : String(cause) });
  }
}

if (parentPort !== null) run(workerData as WorkerCall);
