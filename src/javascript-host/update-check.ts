import type { HostPlaces } from "../context/places.js";
import type { WorkerAnswer } from "../context/runtime-worker.js";
import { callInWorker, COMPILED_WORKER } from "../context/worker-call.js";
import type { BundleProblem } from "../plugins/cache-bundles.js";
import type { RuntimeSource } from "../runtime/open.js";

const STOPPED = "the host stopped before the update check finished";

export interface UpdateCheck {
  source: RuntimeSource;
  places: HostPlaces;
  hostId: string;
  settings: Record<string, unknown>;
  problems(): BundleProblem[];
}

/** One `updates.check` of `check.hostId` on a worker thread, because it waits on the network; `signal` terminates it. */
export function checkInWorker(check: UpdateCheck, signal: AbortSignal): Promise<WorkerAnswer> {
  const problems = check.problems().map(({ id, version }) => ({ id, version }));
  const argument = { places: { state: check.places.state, cache: check.places.cache }, hostId: check.hostId, now: new Date().toISOString(), settings: check.settings, problems };
  return callInWorker({ source: check.source, service: "updates", function: "check", argument }, COMPILED_WORKER, STOPPED, signal);
}
