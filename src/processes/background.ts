import { spawn } from "node:child_process";
import { bootEntryFile } from "../boot/boot-install.js";
import { FOREBAY_HOST_ID } from "../install/forebay-host.js";
import { isProcessAlive, liveHolders, readHolders, withHoldersLock, writeHolders } from "./holders.js";

/** Starts a background host's process and answers its pid. */
export type ProcessStarter = () => number;

export interface BackgroundStart {
  cache: string;
  /** The directory the process runs in; one of spisor's own places, so it never holds the user's. */
  directory: string;
  hostId: string;
  environment: Record<string, string>;
}

/**
 * @implNote On Windows a signal cannot be delivered to another process, so the stop is
 * `process.kill` with no signal, which terminates it.
 */
function stopProcess(pid: number): void {
  try {
    if (process.platform === "win32") process.kill(pid);
    else process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
}

/**
 * Starts `forebay-host background <host-id>` through the cache's boot entry, detached from the
 * caller so it outlives a launcher that dies, with no terminal of its own.
 */
export function backgroundHostStarter(start: BackgroundStart): ProcessStarter {
  return () => {
    const child = spawn(process.execPath, [bootEntryFile(start.cache), FOREBAY_HOST_ID, "background", start.hostId], {
      cwd: start.directory,
      env: start.environment,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    if (child.pid === undefined) throw new Error(`the background host ${start.hostId} could not be started`);
    return child.pid;
  };
}

/**
 * Makes `holder` a holder of background host `hostId`, starting its process when none is alive, and
 * answers the pid of the process it holds.
 */
export function holdBackgroundHost(state: string, hostId: string, start: ProcessStarter, holder: number = process.pid): Promise<number> {
  return withHoldersLock(state, hostId, () => {
    const record = readHolders(state, hostId);
    const pid = record.pid !== null && isProcessAlive(record.pid) ? record.pid : start();
    const holders = liveHolders(record).filter((held) => held !== holder);
    writeHolders(state, hostId, { pid, holders: [...holders, holder] });
    return pid;
  });
}

/** Drops `holder` from background host `hostId`, and stops its process when no live holder is left. */
export function releaseBackgroundHost(state: string, hostId: string, holder: number = process.pid): Promise<void> {
  return withHoldersLock(state, hostId, () => {
    const record = readHolders(state, hostId);
    const holders = liveHolders(record).filter((held) => held !== holder);
    if (holders.length > 0) {
      writeHolders(state, hostId, { pid: record.pid, holders });
      return;
    }
    if (record.pid !== null) stopProcess(record.pid);
    writeHolders(state, hostId, { pid: null, holders: [] });
  });
}
