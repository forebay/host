import type { WorkerAnswer } from "../context/runtime-worker.js";
import type { UpdatesService } from "../runtime/types.js";

/** @implNote Every tick calls `updates.check`, which itself skips a source asked within its `updates.intervalHours`. */
const TICK_MILLISECONDS = 3_600_000;

type CheckAnswer = ReturnType<UpdatesService["check"]>;

export interface UpdateTimerOptions {
  hostId: string;
  /** One `updates.check`, run off the main thread. */
  check(): Promise<WorkerAnswer>;
  writeError(text: string): void;
}

export interface UpdateTimer {
  /** What the last `updates.check` answered, or null before the first has finished. */
  lastCheck(): WorkerAnswer | null;
  stop(): Promise<void>;
}

function report(options: UpdateTimerOptions, answer: WorkerAnswer): void {
  if ("failed" in answer) {
    options.writeError(`spisor could not check for updates of ${options.hostId}: ${answer.failed}\n`);
    return;
  }
  for (const { id, message, fix } of (answer.answer as CheckAnswer).refused) options.writeError(`spisor could not update ${id}: ${message}\nfix: ${fix}\n`);
}

/**
 * Calls `updates.check` at once and then every hour, never two at once, writing a failed check and
 * every refused version to stderr.
 *
 * @implNote The timer is unreferenced, so it never keeps a process alive by itself.
 */
export function startUpdateTimer(options: UpdateTimerOptions): UpdateTimer {
  let last: WorkerAnswer | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    running ??= options.check().then((answer) => {
      last = answer;
      running = null;
      if (!stopped) report(options, answer);
    });
  };
  const timer = setInterval(tick, TICK_MILLISECONDS);
  timer.unref();
  tick();
  return {
    lastCheck: () => last,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
