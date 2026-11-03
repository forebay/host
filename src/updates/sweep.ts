import { rmdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { installedLibraries, libraryPlatforms } from "../cache/installed-libraries.js";
import { isStrictlyInside } from "../cache/strictly-inside.js";
import { installedVersions } from "./installed.js";
import { readReferences } from "./references.js";
import { newestVersion } from "./semver.js";

function referencedVersions(state: string): Set<string> {
  const referenced = new Set<string>();
  for (const { run, next } of readReferences(state)) {
    for (const [id, version] of [...Object.entries(run), ...Object.entries(next)]) referenced.add(`${id}@${version}`);
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

function sweepLibraries(cache: string, referenced: Set<string>): string[] {
  const root = resolve(cache, "libraries");
  return libraryPlatforms(cache).flatMap((platform) =>
    unkept(installedLibraries(cache, platform), referenced)
      .filter(({ id, version }) => removeLibraryVersion(root, id, version, platform))
      .map(({ id, version }) => `${id}@${version} for ${platform}`),
  );
}

/**
 * Deletes every installed bundle version, and every library version per platform, that no host's
 * reference file names, as run or as scheduled for its next start, keeping each id's newest installed
 * version as the rollback.
 *
 * @remarks A version with no completion marker is left alone, since another host sharing the cache
 * may be installing it right now. A version that cannot be removed (a file another process holds
 * open on Windows) is skipped and tried again by the next sweep.
 */
export function sweepCache(cache: string, state: string): { removed: string[] } {
  const root = resolve(cache, "bundles");
  const referenced = referencedVersions(state);
  const bundles = unkept(installedVersions(cache), referenced)
    .filter(({ id, version }) => removeVersion(root, id, version))
    .map(({ id, version }) => `${id}@${version}`);
  return { removed: [...bundles, ...sweepLibraries(cache, referenced)] };
}
