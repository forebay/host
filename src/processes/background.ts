import { spawn } from "node:child_process";
import { bootExecutable } from "../boot/boot-executable.js";
import { bootEntryFile } from "../boot/boot-install.js";
import { FOREBAY_HOST_ID } from "../install/forebay-host.js";
import { isHostRunning, liveHolders, readHolders, withHoldersLock, writeHolders } from "./holders.js";

/** Starts a background host's process and answers its pid. */
export type ProcessStarter = () => number;

export interface BackgroundStart {
  cache: string;
  /** The directory the process runs in; one of spisor's own places, so it never holds the user's. */
  directory: string;
  hostId: string;
  environment: Record<string, string>;
}

/** The command line that starts `forebay-host background <host-id>` through the cache's boot entry. */
export function backgroundHostCommand(start: BackgroundStart): { command: string; arguments: string[] } {
  return { command: bootExecutable(start.cache), arguments: [bootEntryFile(start.cache), FOREBAY_HOST_ID, "background", start.hostId] };
}

/**
 * Starts the background host through {@link backgroundHostCommand}, detached from the caller so it
 * outlives a launcher that dies, with no terminal of its own.
 */
export function backgroundHostStarter(start: BackgroundStart): ProcessStarter {
  return () => {
    const invocation = backgroundHostCommand(start);
    const child = spawn(invocation.command, invocation.arguments, {
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
 * Makes `holder` a holder of background host `hostId`, starting its process when none is running,
 * and answers the pid of the process it holds.
 */
export function holdBackgroundHost(state: string, hostId: string, start: ProcessStarter, holder: number = process.pid): Promise<number> {
  return withHoldersLock(state, hostId, () => {
    const record = readHolders(state, hostId);
    const holders = [...liveHolders(record).filter((held) => held !== holder), holder];
    if (isHostRunning(record)) {
      writeHolders(state, hostId, { ...record, holders });
      return record.pid as number;
    }
    const pid = start();
    writeHolders(state, hostId, { pid, aliveAt: Date.now(), checkMilliseconds: null, holders });
    return pid;
  });
}

/**
 * Drops `holder` from background host `hostId`.
 *
 * @remarks The host is never signalled: it sees no live holder at its next check and stops itself,
 * which lets it stop its plugins on every operating system.
 */
export function releaseBackgroundHost(state: string, hostId: string, holder: number = process.pid): Promise<void> {
  return withHoldersLock(state, hostId, () => {
    const record = readHolders(state, hostId);
    writeHolders(state, hostId, { ...record, holders: liveHolders(record).filter((held) => held !== holder) });
  });
}
