import { liveHolders, readHolders, withHoldersLock, writeHolders } from "./holders.js";

/** How often a background host checks for a live holder when its settings name no interval. */
export const DEFAULT_HOLDER_CHECK_MILLISECONDS = 5000;

function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Prunes dead holders under the lock, answering whether none is left; when none is, the record of
 * this process is removed before the lock is released, so a launcher arriving next starts a new one.
 */
function pruneHolders(state: string, hostId: string, self: number): Promise<boolean> {
  return withHoldersLock(state, hostId, () => {
    const record = readHolders(state, hostId);
    const holders = liveHolders(record);
    const pid = record.pid === self ? null : record.pid;
    writeHolders(state, hostId, holders.length > 0 ? { pid: record.pid, holders } : { pid, holders: [] });
    return holders.length === 0;
  });
}

/**
 * Runs inside background host `hostId`: every `intervalMs` it prunes the holders that died, and it
 * resolves once no holder is alive, or when `signal` aborts.
 *
 * @remarks This is what keeps no background host alive once no application that needs it is open,
 * whether its launchers exited or were killed.
 */
export async function selfExitWhenUnheld(state: string, hostId: string, intervalMs: number = DEFAULT_HOLDER_CHECK_MILLISECONDS, signal?: AbortSignal, self: number = process.pid): Promise<void> {
  const aborted = (): boolean => signal?.aborted === true;
  while (!aborted()) {
    await delay(intervalMs, signal);
    if (aborted() || (await pruneHolders(state, hostId, self))) return;
  }
}
