import { rmSync } from "node:fs";
import { resolve } from "node:path";
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

function removeVersion(root: string, id: string, version: string): boolean {
  const directory = resolve(root, id, version);
  if (!isStrictlyInside(resolve(root, id), directory) || !isStrictlyInside(root, resolve(root, id))) return false;
  try {
    rmSync(directory, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes every installed bundle version no host's reference file names, as run or as scheduled for
 * its next start, keeping each id's newest installed version as the rollback.
 *
 * @remarks A version with no completion marker is left alone, since another host sharing the cache
 * may be installing it right now. A version that cannot be removed (a file another process holds
 * open on Windows) is skipped and tried again by the next sweep.
 */
export function sweepCache(cache: string, state: string): { removed: string[] } {
  const root = resolve(cache, "bundles");
  const removed = unkept(installedVersions(cache), referencedVersions(state))
    .filter(({ id, version }) => removeVersion(root, id, version))
    .map(({ id, version }) => `${id}@${version}`);
  return { removed };
}
