import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { isRecord } from "../plugins/is-record.js";
import { removeRunRecords } from "./run-records.js";

const REFERENCE_EXTENSION = ".json";

/**
 * The bundle versions one host holds: what it runs now, what it scheduled for its next start, and
 * what it ran before this start switched it, kept so the switch can be rolled back until a later start.
 */
export interface HostReferences {
  run: Record<string, string>;
  next: Record<string, string>;
  rollback?: Record<string, string>;
}

function referencesFolder(state: string): string {
  return resolve(state, "bundles");
}

function referenceFile(state: string, hostId: string): string {
  const folder = referencesFolder(state);
  const file = resolve(folder, `${hostId}${REFERENCE_EXTENSION}`);
  if (hostId === "" || !isStrictlyInside(folder, file)) {
    throw new Error(`the host id ${JSON.stringify(hostId)} would record its bundles outside ${folder}; give the host an id that is a plain file name`);
  }
  return file;
}

function isVersionMap(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((version) => typeof version === "string");
}

function referencesOf(text: string): HostReferences | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !isVersionMap(value.run) || !isVersionMap(value.next)) return undefined;
    return isVersionMap(value.rollback) && Object.keys(value.rollback).length > 0 ? { run: value.run, next: value.next, rollback: value.rollback } : { run: value.run, next: value.next };
  } catch {
    return undefined;
  }
}

function readIfFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

function referenceNames(folder: string): string[] {
  try {
    return readdirSync(folder).filter((name) => name.endsWith(REFERENCE_EXTENSION)).sort();
  } catch {
    return [];
  }
}

/**
 * Records which bundle versions this host runs, which it fetches for its next start and which it
 * keeps for rollback, so a sweep from any host sharing the cache keeps all three.
 *
 * @implNote Written beside its name and renamed, so a sweep never reads a half-written file and takes it for none.
 */
export function recordReferences(state: string, hostId: string, references: HostReferences): void {
  const file = referenceFile(state, hostId);
  mkdirSync(referencesFolder(state), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const rollback = references.rollback ?? {};
    const recorded = { run: references.run, next: references.next, ...(Object.keys(rollback).length > 0 ? { rollback } : {}) };
    writeFileSync(temporary, `${JSON.stringify(recorded, null, 2)}\n`);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Deletes the file `hostId` recorded its versions in and every run record of its starts; a host that recorded none is left as it is. */
export function removeHostReferences(state: string, hostId: string): void {
  rmSync(referenceFile(state, hostId), { force: true });
  removeRunRecords(state, hostId);
}

/** Every host's recorded versions, ordered by host; a file that is not at least two maps of versions is skipped. */
export function readReferences(state: string): HostReferences[] {
  const folder = referencesFolder(state);
  return referenceNames(folder).flatMap((name) => {
    const text = readIfFile(join(folder, name));
    const references = text === undefined ? undefined : referencesOf(text);
    return references === undefined ? [] : [references];
  });
}

/** The versions `hostId` recorded, or empty maps when it recorded none readable. */
export function readHostReferences(state: string, hostId: string): HostReferences {
  const text = readIfFile(referenceFile(state, hostId));
  return (text === undefined ? undefined : referencesOf(text)) ?? { run: {}, next: {} };
}

/**
 * Records `version` as the one `hostId` runs of itself, keeping every other version it recorded.
 *
 * @implNote Keeps what the host scheduled for its next start, so recording the registered version never forgets an update already fetched.
 */
export function recordRunningVersion(state: string, hostId: string, version: string): void {
  const recorded = readHostReferences(state, hostId);
  recordReferences(state, hostId, { ...recorded, run: { ...recorded.run, [hostId]: version } });
}
