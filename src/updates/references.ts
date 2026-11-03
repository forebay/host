import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { isRecord } from "../plugins/is-record.js";

const REFERENCE_EXTENSION = ".json";

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

function versionsOf(text: string): Record<string, string> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && Object.values(value).every((version) => typeof version === "string") ? (value as Record<string, string>) : undefined;
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
 * Records which bundle versions this host runs, so a sweep from any host sharing the cache keeps them.
 *
 * @implNote Written beside its name and renamed, so a sweep never reads a half-written file and takes it for none.
 */
export function recordReferences(state: string, hostId: string, run: Record<string, string>): void {
  const file = referenceFile(state, hostId);
  mkdirSync(referencesFolder(state), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Every host's recorded versions, ordered by host; a file that is not a map of versions is skipped. */
export function readReferences(state: string): Array<Record<string, string>> {
  const folder = referencesFolder(state);
  return referenceNames(folder).flatMap((name) => {
    const text = readIfFile(join(folder, name));
    const versions = text === undefined ? undefined : versionsOf(text);
    return versions === undefined ? [] : [versions];
  });
}
