import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { isRecord } from "../plugins/is-record.js";
import { DEFAULT_HOLDER_CHECK_MILLISECONDS, isStampFresh } from "../processes/holders.js";
import type { AliveStamp } from "../processes/holders.js";

const RECORD_EXTENSION = ".json";

/** One live start of a host: the process running it, stamped alive, and the versions it runs. */
interface RunRecord extends AliveStamp {
  run: Record<string, string>;
}

/** A start's own run record, kept stamped until it is released. */
export interface HeldRunRecord {
  release(): void;
}

function runsFolder(state: string): string {
  return resolve(state, "bundles", "runs");
}

function hostFolder(state: string, hostId: string): string {
  const folder = runsFolder(state);
  const directory = resolve(folder, hostId);
  if (hostId === "" || !isStrictlyInside(folder, directory)) {
    throw new Error(`the host id ${JSON.stringify(hostId)} would record its runs outside ${folder}; give the host an id that is a plain file name`);
  }
  return directory;
}

function isVersionMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((version) => typeof version === "string");
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordOf(text: string): RunRecord | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !isVersionMap(value.run)) return undefined;
    return { pid: numberOrNull(value.pid), aliveAt: numberOrNull(value.aliveAt), checkMilliseconds: numberOrNull(value.checkMilliseconds), run: value.run };
  } catch {
    return undefined;
  }
}

function namesIn(directory: string, wanted: (name: string) => boolean): string[] {
  try {
    return readdirSync(directory).filter(wanted);
  } catch {
    return [];
  }
}

/** @implNote Written beside its name and renamed, so a sweep never reads half a record and takes it for none. */
function writeRecord(file: string, record: RunRecord): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(record)}\n`);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Records that this process runs `run` as a start of `hostId`, and keeps stamping it alive every
 * `intervalMs` until it is released, which removes it.
 *
 * @remarks One file per start, so two starts of one host on different versions never overwrite each
 * other's: a sweep keeps every version any live start names. The timer never keeps the process alive.
 */
export function holdRunRecord(state: string, hostId: string, run: Record<string, string>, intervalMs: number = DEFAULT_HOLDER_CHECK_MILLISECONDS): HeldRunRecord {
  const directory = hostFolder(state, hostId);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${process.pid}.${randomUUID()}${RECORD_EXTENSION}`);
  const stamp = () => {
    mkdirSync(directory, { recursive: true });
    writeRecord(file, { pid: process.pid, aliveAt: Date.now(), checkMilliseconds: intervalMs, run });
  };
  stamp();
  const timer = setInterval(stamp, intervalMs);
  timer.unref();
  return {
    release: () => {
      clearInterval(timer);
      rmSync(file, { force: true });
    },
  };
}

function hostIds(state: string): string[] {
  try {
    return readdirSync(runsFolder(state), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * The versions every live start of any host runs, removing each record whose process is gone or
 * stopped stamping, by the same liveness a background host's holders are judged by.
 */
export function liveRuns(state: string, now: number = Date.now()): Array<Record<string, string>> {
  return hostIds(state).flatMap((hostId) => {
    const directory = hostFolder(state, hostId);
    return namesIn(directory, (name) => name.endsWith(RECORD_EXTENSION)).flatMap((name) => {
      const file = join(directory, name);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return [];
      }
      const record = recordOf(text);
      if (record !== undefined && isStampFresh(record, now)) return [record.run];
      rmSync(file, { force: true });
      return [];
    });
  });
}

/** Deletes every run record of `hostId`. */
export function removeRunRecords(state: string, hostId: string): void {
  rmSync(hostFolder(state, hostId), { recursive: true, force: true });
}
