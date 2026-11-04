import type { Runtime } from "../runtime/open.js";

export const CHECK_MILLISECONDS = 5000;

export interface ProcessTimerOptions {
  runtime: Pick<Runtime, "processes">;
  state: string;
  hostId: string;
  run: Record<string, string>;
  record: string;
  /** Whether this process is a background host its holders keep alive, so `processes.prune` decides when it exits. */
  held: boolean;
  onUnheld(): void;
  onFailure(message: string): void;
}

export interface ProcessTimer {
  stop(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One turn: stamps this start's run record alive and, for a held host, answers whether it should exit. */
function turn(options: ProcessTimerOptions): boolean {
  const { runtime, state, hostId } = options;
  runtime.processes.recordRun({ state, hostId, run: options.run, record: options.record, checkMilliseconds: CHECK_MILLISECONDS });
  return options.held && runtime.processes.prune({ state, hostId, self: process.pid, checkMilliseconds: CHECK_MILLISECONDS }).exit;
}

/**
 * At once and then every {@link CHECK_MILLISECONDS}, stamps the run record that keeps this start's
 * versions from any sweep and, for a held host, asks `processes.prune` whether a holder is still
 * alive, calling `onUnheld` once when none is.
 *
 * @implNote A session host's timer is unreferenced, since the application's own process decides
 * when it ends; a held host's keeps its process alive until it is unheld.
 */
export function startProcessTimer(options: ProcessTimerOptions): ProcessTimer {
  let timer: NodeJS.Timeout | undefined;
  const stop = () => clearInterval(timer);
  const tick = () => {
    try {
      if (!turn(options)) return;
      stop();
      options.onUnheld();
    } catch (error) {
      options.onFailure(messageOf(error));
    }
  };
  timer = setInterval(tick, CHECK_MILLISECONDS);
  if (!options.held) timer.unref();
  tick();
  return { stop };
}
