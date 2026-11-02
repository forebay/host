import { workerData } from "node:worker_threads";

Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.blockMilliseconds ?? 600);
await import("../../dist/context/reconcile-worker.js");
