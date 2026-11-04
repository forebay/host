import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { isRecord } from "../plugins/is-record.js";
import type { HostLibraries } from "../runtime/cached-runtime.js";

/** What the next start of a host loads: its runtime and koffi, and the version of the host bundle itself. */
export interface BootHint {
  libraries: Record<string, string>;
  host?: string;
}

const HINT_EXTENSION = ".json";

function hintFile(cache: string, hostId: string): string {
  const folder = resolve(cache, "hosts");
  const file = resolve(folder, `${hostId}.json`);
  if (hostId === "" || !isStrictlyInside(folder, file)) throw new Error(`the host id ${JSON.stringify(hostId)} would record its libraries outside ${folder}`);
  return file;
}

function stringEntries(value: unknown): Record<string, string> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {};
}

/** The hint `hostId` last recorded; undefined when there is none or it is not readable JSON. */
export function readBootHint(cache: string, hostId: string): BootHint | undefined {
  const file = hintFile(cache, hostId);
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(value)) return undefined;
    return { libraries: stringEntries(value.libraries), ...(typeof value.host === "string" ? { host: value.host } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * Records for the next start of `hostId` the libraries to load and the host bundle version to run;
 * a version left undefined keeps the one already recorded.
 *
 * @implNote Written beside its name and renamed, so a start never reads a half-written hint.
 */
export function writeBootHint(cache: string, hostId: string, libraries: HostLibraries, host: string | undefined): void {
  const file = hintFile(cache, hostId);
  const version = host ?? readBootHint(cache, hostId)?.host;
  mkdirSync(resolve(cache, "hosts"), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ libraries, ...(version === undefined ? {} : { host: version }) }, null, 2)}\n`);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Makes `version` the host bundle the next start of `hostId` runs, keeping the libraries its hint names; a host whose hint names no runtime and koffi is left as it is. */
export function hintHostVersion(cache: string, hostId: string, version: string): void {
  const { runtime, koffi } = readBootHint(cache, hostId)?.libraries ?? {};
  if (runtime === undefined || koffi === undefined) return;
  writeBootHint(cache, hostId, { runtime, koffi }, version);
}

/**
 * Every `id@version` the hints in `cache` name: each host's runtime and koffi, and its own bundle
 * under the host id.
 */
export function hintedVersions(cache: string): string[] {
  let names: string[];
  try {
    names = readdirSync(resolve(cache, "hosts")).filter((name) => name.endsWith(HINT_EXTENSION));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const hostId = basename(name, HINT_EXTENSION);
    const hint = readBootHint(cache, hostId);
    if (hint === undefined) return [];
    const libraries = Object.entries(hint.libraries).map(([id, version]) => `${id}@${version}`);
    return hint.host === undefined ? libraries : [...libraries, `${hostId}@${hint.host}`];
  });
}
