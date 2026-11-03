import { rmdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { hintedVersions } from "../boot/boot-hint.js";
import { installedLibraries, libraryPlatforms } from "../cache/installed-libraries.js";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { abandonedBundles, abandonedLibraries } from "./abandoned.js";
import { installedVersions } from "./installed.js";
import { readReferences } from "./references.js";
import { newestVersion } from "./semver.js";

function referencedVersions(cache: string, state: string): Set<string> {
  const referenced = new Set<string>(hintedVersions(cache));
  for (const { run, next, rollback } of readReferences(state)) {
    for (const [id, version] of [...Object.entries(run), ...Object.entries(next), ...Object.entries(rollback ?? {})]) referenced.add(`${id}@${version}`);
  }
  return referenced;
}

function unkept(installed: Record<string, string[]>, referenced: Set<string>): Array<{ id: string; version: string }> {
  return Object.entries(installed).flatMap(([id, versions]) => {
    const rollback = newestVersion(versions);
    return versions.filter((version) => version !== rollback && !referenced.has(`${id}@${version}`)).map((version) => ({ id, version }));
  });
}

function removeDirectory(directory: string): boolean {
  try {
    rmSync(directory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function removeVersion(root: string, id: string, version: string): boolean {
  const directory = resolve(root, id, version);
  if (!isStrictlyInside(resolve(root, id), directory) || !isStrictlyInside(root, resolve(root, id))) return false;
  return removeDirectory(directory);
}

function removeLibraryVersion(root: string, id: string, version: string, platform: string): boolean {
  const versionDirectory = resolve(root, id, version);
  const directory = resolve(versionDirectory, platform);
  if (!isStrictlyInside(versionDirectory, directory) || !isStrictlyInside(resolve(root, id), versionDirectory) || !isStrictlyInside(root, resolve(root, id))) return false;
  if (!removeDirectory(directory)) return false;
  try {
    rmdirSync(versionDirectory);
  } catch {
    // another platform of this version is still in the folder
  }
  return true;
}

function sweepLibraries(cache: string, referenced: Set<string>, now: number): string[] {
  const root = resolve(cache, "libraries");
  const unkeptInstalled = libraryPlatforms(cache).flatMap((platform) => unkept(installedLibraries(cache, platform), referenced).map((entry) => ({ ...entry, platform })));
  const abandoned = abandonedLibraries(cache, now).filter(({ id, version }) => !referenced.has(`${id}@${version}`));
  return [...unkeptInstalled, ...abandoned]
    .filter(({ id, version, platform }) => removeLibraryVersion(root, id, version, platform))
    .map(({ id, version, platform }) => `${id}@${version} for ${platform}`);
}

function sweepBundles(cache: string, referenced: Set<string>, now: number): string[] {
  const root = resolve(cache, "bundles");
  const abandoned = abandonedBundles(cache, now).filter(({ id, version }) => !referenced.has(`${id}@${version}`));
  return [...unkept(installedVersions(cache), referenced), ...abandoned]
    .filter(({ id, version }) => removeVersion(root, id, version))
    .map(({ id, version }) => `${id}@${version}`);
}

/**
 * Deletes every installed bundle version, and every library version per platform, that no host's
 * reference file names, as run, as scheduled for its next start or as kept for rollback, nor any boot hint names for the
 * start after (a command shim runs through the hint, so what it names must outlive any sweep), keeping each id's newest installed
 * version as the rollback.
 *
 * @remarks A version with no completion marker is left alone while anything in it changed within
 * the last day, since another host sharing the cache may be installing it right now; older, it is
 * a failed install and is removed unless a reference names it. A version that cannot be removed (a file another process holds
 * open on Windows) is skipped and tried again by the next sweep.
 */
export function sweepCache(cache: string, state: string): { removed: string[] } {
  const referenced = referencedVersions(cache, state);
  const now = Date.now();
  return { removed: [...sweepBundles(cache, referenced, now), ...sweepLibraries(cache, referenced, now)] };
}
