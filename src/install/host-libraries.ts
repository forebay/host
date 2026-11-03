import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { CacheRefusal } from "../cache/cache-refusal.js";
import { checkInstalled } from "../cache/install-marker.js";
import { installedLibraries } from "../cache/installed-libraries.js";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import type { Catalog } from "../catalog/catalog.js";
import { pinnedVersions } from "../plugins/enabled.js";
import type { EnabledPlugin } from "../plugins/enabled.js";
import { isRecord } from "../plugins/is-record.js";
import { cachedRuntime, libraryDirectory } from "../runtime/cached-runtime.js";
import type { HostLibraries } from "../runtime/cached-runtime.js";
import type { RuntimeSource } from "../runtime/open.js";
import { newestVersion } from "../updates/semver.js";
import { resolveVersions } from "../updates/versions.js";

export const RUNTIME_ID = "runtime";
export const KOFFI_ID = "koffi";
const LIBRARY_IDS = [RUNTIME_ID, KOFFI_ID] as const;

function recordFile(cache: string, hostId: string): string {
  const folder = resolve(cache, "hosts");
  const file = resolve(folder, `${hostId}.json`);
  if (hostId === "" || !isStrictlyInside(folder, file)) throw new Error(`the host id ${JSON.stringify(hostId)} would record its libraries outside ${folder}`);
  return file;
}

function readRecord(cache: string, hostId: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(readFileSync(recordFile(cache, hostId), "utf8"));
    const libraries = isRecord(value) && isRecord(value.libraries) ? value.libraries : {};
    return Object.fromEntries(Object.entries(libraries).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function libraryCandidates(settings: Record<string, unknown>): EnabledPlugin[] {
  const pins = pinnedVersions(settings);
  return LIBRARY_IDS.map((id) => (Object.hasOwn(pins, id) ? { id, pin: pins[id] as string } : { id }));
}

function verifiedDirectory(cache: string, id: string, version: string, platformKey: string): void {
  const directory = libraryDirectory(cache, id, version, platformKey);
  const check = checkInstalled(directory);
  if (check.kind === "intact") return;
  if (check.kind === "absent") throw new CacheRefusal(`${id}@${version} is not installed for ${platformKey} in ${directory}`, "run forebay-host install --catalog <path or url> again");
  throw new CacheRefusal(`${id}@${version} was not loaded: ${check.detail}`, check.fix);
}

/**
 * The runtime and koffi versions a host runs, by the rule bundles follow: a pin, else the catalog's
 * `latest` when it is installed, else the newest installed. Pins are read as a plugin's are, from
 * `plugins.<id>.pin`.
 */
export function resolveHostLibraries(catalog: Catalog, settings: Record<string, unknown>, cache: string, platformKey: string): Record<string, string> {
  return resolveVersions(catalog, libraryCandidates(settings), installedLibraries(cache, platformKey), "library").run;
}

/**
 * Records a resolution for the next start of `hostId` to load, in the cache, since a host must load
 * koffi and the runtime before it can read its places.
 */
export function recordBootLibraries(cache: string, hostId: string, libraries: HostLibraries): void {
  const file = recordFile(cache, hostId);
  mkdirSync(resolve(cache, "hosts"), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ libraries }, null, 2)}\n`);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * The libraries a start of `hostId` loads before it can read its settings: what its last resolution
 * recorded, where still installed, else the newest installed; undefined when either is missing.
 *
 * @implNote A newly resolved version therefore switches on the next start, as a bundle does: koffi
 * is a native module that cannot be unloaded once the first resolution has needed it.
 */
export function bootLibraries(cache: string, hostId: string, platformKey: string): HostLibraries | undefined {
  const installed = installedLibraries(cache, platformKey);
  const recorded = readRecord(cache, hostId);
  const pick = (id: string): string | undefined => {
    const versions = installed[id] ?? [];
    const wanted = recorded[id];
    return wanted !== undefined && versions.includes(wanted) ? wanted : newestVersion(versions);
  };
  return hostLibrariesOf(Object.fromEntries(LIBRARY_IDS.flatMap((id) => {
    const version = pick(id);
    return version === undefined ? [] : [[id, version]];
  })));
}

/** The runtime source for `libraries`, after re-hashing every file of both installs; a mismatch is refused, naming the file. */
export function verifiedRuntimeSource(cache: string, libraries: HostLibraries, platformKey: string): RuntimeSource {
  verifiedDirectory(cache, KOFFI_ID, libraries.koffi, platformKey);
  verifiedDirectory(cache, RUNTIME_ID, libraries.runtime, platformKey);
  return cachedRuntime(cache, libraries, platformKey);
}

export function hostLibrariesOf(versions: Record<string, string>): HostLibraries | undefined {
  const runtime = versions[RUNTIME_ID];
  const koffi = versions[KOFFI_ID];
  return runtime === undefined || koffi === undefined ? undefined : { runtime, koffi };
}

export type { HostLibraries };
