import { selfExitWhenUnheld } from "./self-exit.js";

/** What a background host's process runs until it is no longer held. */
export interface BackgroundRun {
  state: string;
  hostId: string;
  intervalMs: number;
  /** Aborted by a stop signal; the run ends as it does once no holder is alive. */
  signal: AbortSignal;
  start(): Promise<{ stop(): Promise<void> }>;
}

/** `stopped`: the host started and was stopped. `abandoned`: the run ended while the start had not answered, so the process must exit by itself. */
export type BackgroundRunEnd = "stopped" | "abandoned";

function linkedController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

function stopWhenStarted(starting: Promise<{ stop(): Promise<void> }>): void {
  starting.then(
    (running) => running.stop(),
    () => undefined,
  ).catch(() => undefined);
}

/**
 * Starts the host and runs the holder loop beside it from the first moment, so the process stamps
 * itself alive and prunes dead holders while the start is still under way, then stops the host
 * once no holder is alive, another process took its place, or `signal` aborts.
 *
 * @implNote A start that never answers would otherwise keep the stamp stale, so a launcher starts a
 * second host while the first outlives every application. When the loop ends first the start is
 * abandoned: a host it gives back later is stopped, and the caller exits the process.
 */
export async function runUntilUnheld(run: BackgroundRun): Promise<BackgroundRunEnd> {
  const controller = linkedController(run.signal);
  const unheld = selfExitWhenUnheld(run.state, run.hostId, run.intervalMs, controller.signal);
  const starting = run.start();
  let running: { stop(): Promise<void> } | undefined;
  try {
    running = await Promise.race([starting, unheld.then(() => undefined)]);
  } catch (error) {
    controller.abort();
    await unheld;
    throw error;
  }
  if (running === undefined) {
    stopWhenStarted(starting);
    return "abandoned";
  }
  try {
    await unheld;
  } finally {
    await running.stop();
  }
  return "stopped";
}
