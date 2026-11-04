import type { HostPlaces } from "../context/places.js";
import type { WorkerAnswer } from "../context/runtime-worker.js";
import { callInWorker, COMPILED_WORKER } from "../context/worker-call.js";
import type { BundleProblem } from "../plugins/cache-bundles.js";
import { isRecord } from "../plugins/is-record.js";
import type { RuntimeSource } from "../runtime/open.js";

const DEFAULT_INTERVAL_HOURS = 24;
const MILLISECONDS_PER_HOUR = 3_600_000;
/** @implNote A longer delay overflows Node's timer, which then fires after one millisecond. */
const LONGEST_TIMER_MILLISECONDS = 2_147_483_647;
const STOPPED = "the host stopped before the update check finished";

export interface UpdateTimerOptions {
  source: RuntimeSource;
  places: HostPlaces;
  hostId: string;
  settings: Record<string, unknown>;
  problems(): BundleProblem[];
}

export interface UpdateTimer {
  /** What the last `updates.check` answered, or null before the first has finished. */
  lastCheck(): WorkerAnswer | null;
  stop(): Promise<void>;
}

/** `updates.intervalHours` from the ecosystem settings, 24 when it is absent or not a positive number. */
function intervalHoursOf(settings: Record<string, unknown>): number {
  const configured = isRecord(settings.updates) ? settings.updates.intervalHours : undefined;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_HOURS;
}

function checkArgument(options: UpdateTimerOptions): unknown {
  const problems = options.problems().map(({ id, version }) => ({ id, version }));
  return { places: { state: options.places.state, cache: options.places.cache }, hostId: options.hostId, now: new Date().toISOString(), settings: options.settings, problems };
}

/**
 * Runs `updates.check` at once and then every `updates.intervalHours`, each on a worker thread
 * because it waits on the network, never two at once.
 *
 * @implNote The timer is unreferenced, so it never keeps a process alive by itself.
 */
export function startUpdateTimer(options: UpdateTimerOptions): UpdateTimer {
  const controller = new AbortController();
  let last: WorkerAnswer | null = null;
  let running: Promise<void> | null = null;
  const check = () => {
    running ??= callInWorker({ source: options.source, service: "updates", function: "check", argument: checkArgument(options) }, COMPILED_WORKER, STOPPED, controller.signal).then((answer) => {
      last = answer;
      running = null;
    });
  };
  const timer = setInterval(check, Math.min(intervalHoursOf(options.settings) * MILLISECONDS_PER_HOUR, LONGEST_TIMER_MILLISECONDS));
  timer.unref();
  check();
  return {
    lastCheck: () => last,
    stop: async () => {
      clearInterval(timer);
      controller.abort();
      await running;
    },
  };
}
