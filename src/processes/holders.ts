import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { isRecord } from "../plugins/is-record.js";

const STALE_LOCK_MILLISECONDS = 10000;
const LOCK_RETRY_MILLISECONDS = 25;

/** The process running one background host, and the launchers holding it, each by its pid. */
export interface HoldersRecord {
  pid: number | null;
  holders: number[];
}

const EMPTY: HoldersRecord = { pid: null, holders: [] };

function processesFolder(state: string): string {
  return resolve(state, "processes");
}

function fileIn(state: string, hostId: string, extension: string): string {
  const folder = processesFolder(state);
  const file = resolve(folder, `${hostId}${extension}`);
  if (hostId === "" || !isStrictlyInside(folder, file)) {
    throw new Error(`the host id ${JSON.stringify(hostId)} would record its processes outside ${folder}; give the host an id that is a plain file name`);
  }
  return file;
}

function lockFile(state: string, hostId: string): string {
  return fileIn(state, hostId, ".lock");
}

function isPid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function recordOf(text: string): HoldersRecord {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !Array.isArray(value.holders) || !value.holders.every(isPid)) return EMPTY;
    return { pid: isPid(value.pid) ? value.pid : null, holders: value.holders };
  } catch {
    return EMPTY;
  }
}

function readIfFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

/** @implNote EPERM means the process exists but belongs to someone this process may not signal. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function isStale(lock: string): boolean {
  const text = readIfFile(lock);
  if (text === undefined) return false;
  const pid = Number.parseInt(text, 10);
  if (!isPid(pid) || !isProcessAlive(pid)) return true;
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MILLISECONDS;
  } catch {
    return false;
  }
}

function tryCreateLock(lock: string): boolean {
  try {
    const descriptor = openSync(lock, "wx");
    try {
      writeSync(descriptor, String(process.pid));
    } finally {
      closeSync(descriptor);
    }
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/** @implNote The stale lock is renamed away before it is deleted, so of two takers seeing it stale only one removes it. */
function removeStaleLock(lock: string): void {
  const moved = `${lock}.${randomUUID()}.stale`;
  try {
    renameSync(lock, moved);
  } catch {
    return;
  }
  rmSync(moved, { force: true });
}

async function acquireLock(lock: string): Promise<void> {
  while (!tryCreateLock(lock)) {
    if (isStale(lock)) {
      removeStaleLock(lock);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MILLISECONDS));
  }
}

/** Where the holders of background host `hostId` are recorded. */
export function holdersFile(state: string, hostId: string): string {
  return fileIn(state, hostId, ".json");
}

/** What `hostId`'s holders file records; empty when there is none or it is not a holders record. */
export function readHolders(state: string, hostId: string): HoldersRecord {
  const text = readIfFile(holdersFile(state, hostId));
  return text === undefined ? EMPTY : recordOf(text);
}

/**
 * Records `record` for `hostId`, removing the file once it names neither a process nor a holder.
 *
 * @implNote Written beside its name and renamed, so a reader never sees half a record.
 */
export function writeHolders(state: string, hostId: string, record: HoldersRecord): void {
  const file = holdersFile(state, hostId);
  if (record.pid === null && record.holders.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(processesFolder(state), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const descriptor = openSync(temporary, "w");
    try {
      writeSync(descriptor, `${JSON.stringify({ pid: record.pid, holders: record.holders })}\n`);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The holders of `record` whose process is still alive. */
export function liveHolders(record: HoldersRecord): number[] {
  return record.holders.filter(isProcessAlive);
}

/**
 * Runs `work` holding `hostId`'s lock file, so one process at a time reads and writes its holders.
 *
 * @remarks A lock whose process is dead, or older than ten seconds, is stale and taken.
 */
export async function withHoldersLock<T>(state: string, hostId: string, work: () => T | Promise<T>): Promise<T> {
  const lock = lockFile(state, hostId);
  mkdirSync(processesFolder(state), { recursive: true });
  await acquireLock(lock);
  try {
    return await work();
  } finally {
    rmSync(lock, { force: true });
  }
}
