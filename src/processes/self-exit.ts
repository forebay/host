import { DEFAULT_HOLDER_CHECK_MILLISECONDS, liveHolders, NO_HOLDERS, readHolders, withHoldersLock, writeHolders } from "./holders.js";

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
 * One check under the lock, answering whether this host should exit: when another process is
 * recorded as the host, or no holder is alive. Otherwise the dead holders are pruned and this host
 * stamps itself alive.
 *
 * @implNote With no holder left the record is removed before the lock is released, so a launcher
 * arriving next starts a new host rather than holding one that is about to exit.
 */
function checkHolders(state: string, hostId: string, intervalMs: number, self: number): Promise<boolean> {
  return withHoldersLock(state, hostId, () => {
    const record = readHolders(state, hostId);
    if (record.pid !== null && record.pid !== self) return true;
    const holders = liveHolders(record);
    if (holders.length === 0) {
      writeHolders(state, hostId, NO_HOLDERS);
      return true;
    }
    writeHolders(state, hostId, { pid: self, aliveAt: Date.now(), checkMilliseconds: intervalMs, holders });
    return false;
  });
}

/**
 * Runs inside background host `hostId`: at once and then every `intervalMs` it prunes the holders
 * that died and stamps itself alive, and it resolves once no holder is alive, another process has
 * taken its place, or `signal` aborts.
 *
 * @remarks This is what keeps no background host alive once no application that needs it is open,
 * whether its launchers exited or were killed.
 */
export async function selfExitWhenUnheld(state: string, hostId: string, intervalMs: number = DEFAULT_HOLDER_CHECK_MILLISECONDS, signal?: AbortSignal, self: number = process.pid): Promise<void> {
  const aborted = (): boolean => signal?.aborted === true;
  while (!aborted()) {
    if (await checkHolders(state, hostId, intervalMs, self)) return;
    await delay(intervalMs, signal);
  }
}
