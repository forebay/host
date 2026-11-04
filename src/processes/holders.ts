import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { isRecord } from "../plugins/is-record.js";

/** How often a background host checks for a live holder when its settings name no interval. */
export const DEFAULT_HOLDER_CHECK_MILLISECONDS = 5000;

const STALE_LOCK_MILLISECONDS = 10000;
const MISSED_CHECKS_BEFORE_DEAD = 3;
const LOCK_RETRY_MILLISECONDS = 25;

/**
 * The process running one background host and the launchers holding it, each by its pid.
 *
 * @remarks `aliveAt` is when the host last said it was running, in epoch milliseconds, and
 * `checkMilliseconds` how often it says so; both null until the host's first check.
 */
export interface HoldersRecord {
  pid: number | null;
  aliveAt: number | null;
  checkMilliseconds: number | null;
  holders: number[];
}

/** A record naming no process and no holder. */
export const NO_HOLDERS: HoldersRecord = { pid: null, aliveAt: null, checkMilliseconds: null, holders: [] };

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

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordOf(text: string): HoldersRecord {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !Array.isArray(value.holders) || !value.holders.every(isPid)) return NO_HOLDERS;
    return { pid: isPid(value.pid) ? value.pid : null, aliveAt: numberOrNull(value.aliveAt), checkMilliseconds: numberOrNull(value.checkMilliseconds), holders: value.holders };
  } catch {
    return NO_HOLDERS;
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

function writeNew(path: string, text: string, flags: "w" | "wx"): void {
  const descriptor = openSync(path, flags);
  try {
    writeSync(descriptor, text);
  } finally {
    closeSync(descriptor);
  }
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

function isStale(lock: string, token: string): boolean {
  const pid = Number.parseInt(token, 10);
  if (!isPid(pid) || !isProcessAlive(pid)) return true;
  try {
    return Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MILLISECONDS;
  } catch {
    return false;
  }
}

function tryCreateLock(lock: string, token: string): boolean {
  try {
    writeNew(lock, token, "wx");
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/**
 * Moves the lock judged stale away, and puts it back when what was moved is not the lock that was
 * judged, since another taker may have replaced it in between.
 *
 * @implNote The put-back is a hard link, which refuses to replace a lock created meanwhile.
 */
function removeStaleLock(lock: string, judged: string): void {
  const moved = `${lock}.${randomUUID()}.stale`;
  try {
    renameSync(lock, moved);
  } catch {
    return;
  }
  try {
    if (readIfFile(moved) !== judged) linkSync(moved, lock);
  } catch {
    // a newer lock took its place, so the one moved is lost to its owner
  } finally {
    rmSync(moved, { force: true });
  }
}

async function acquireLock(lock: string, token: string): Promise<void> {
  while (!tryCreateLock(lock, token)) {
    const held = readIfFile(lock);
    if (held !== undefined && isStale(lock, held)) {
      removeStaleLock(lock, held);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MILLISECONDS));
  }
}

function releaseLock(lock: string, token: string): void {
  if (readIfFile(lock) === token) rmSync(lock, { force: true });
}

/** Where the holders of background host `hostId` are recorded. */
export function holdersFile(state: string, hostId: string): string {
  return fileIn(state, hostId, ".json");
}

/** What `hostId`'s holders file records; {@link NO_HOLDERS} when there is none or it is not a holders record. */
export function readHolders(state: string, hostId: string): HoldersRecord {
  const text = readIfFile(holdersFile(state, hostId));
  return text === undefined ? NO_HOLDERS : recordOf(text);
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
    writeNew(temporary, `${JSON.stringify(record)}\n`, "w");
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** A process saying it is alive: its pid, when it last said so in epoch milliseconds, and how often it says so. */
export interface AliveStamp {
  pid: number | null;
  aliveAt: number | null;
  checkMilliseconds: number | null;
}

/**
 * Whether the process `stamp` names is still running: its pid is alive and it said so within three
 * of its checks.
 *
 * @implNote The stamp is what tells a running process from an unrelated one that was given its pid
 * after it died, which a pid alone cannot; before its first check the default interval applies.
 */
export function isStampFresh(stamp: AliveStamp, now: number = Date.now()): boolean {
  if (stamp.pid === null || stamp.aliveAt === null || !isProcessAlive(stamp.pid)) return false;
  return now - stamp.aliveAt <= MISSED_CHECKS_BEFORE_DEAD * (stamp.checkMilliseconds ?? DEFAULT_HOLDER_CHECK_MILLISECONDS);
}

/** Whether the host `record` names is running, by its stamp. */
export function isHostRunning(record: HoldersRecord, now: number = Date.now()): boolean {
  return isStampFresh(record, now);
}

/** The holders of `record` whose process is still alive. */
export function liveHolders(record: HoldersRecord): number[] {
  return record.holders.filter(isProcessAlive);
}

/**
 * Runs `work` holding `hostId`'s lock file, so one process at a time reads and writes its holders.
 *
 * @remarks The lock holds the locker's pid and a token of its own, and is removed only while it
 * still holds that token. A lock whose process is dead, or older than ten seconds, is stale and taken.
 */
export async function withHoldersLock<T>(state: string, hostId: string, work: () => T | Promise<T>): Promise<T> {
  const lock = lockFile(state, hostId);
  const token = `${process.pid} ${randomUUID()}`;
  mkdirSync(processesFolder(state), { recursive: true });
  await acquireLock(lock, token);
  try {
    return await work();
  } finally {
    releaseLock(lock, token);
  }
}
