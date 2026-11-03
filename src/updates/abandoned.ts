import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hasCompletionMarker } from "../cache/install-marker.js";

/**
 * How long an unmarked version may sit unchanged before it counts as a failed install.
 *
 * @implNote A download is bounded by the fetcher's deadline per file, so a day is far past any
 * install still writing, while short enough that a failed one stops holding its disk.
 */
const ABANDONED_AFTER_MS = 24 * 3_600_000;

export interface CachedVersion {
  id: string;
  version: string;
}

export interface CachedLibraryVersion extends CachedVersion {
  platform: string;
}

function folderNames(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** The latest modification time of `path` or anything under it, not following links. */
function newestChange(path: string): number {
  const own = lstatSync(path);
  if (!own.isDirectory()) return own.mtimeMs;
  return readdirSync(path).reduce((newest, name) => Math.max(newest, newestChange(join(path, name))), own.mtimeMs);
}

function isAbandoned(directory: string, now: number): boolean {
  if (hasCompletionMarker(directory)) return false;
  try {
    return now - newestChange(directory) > ABANDONED_AFTER_MS;
  } catch {
    return false;
  }
}

/** Bundle versions in the cache with no completion marker and nothing written for more than a day. */
export function abandonedBundles(cache: string, now: number): CachedVersion[] {
  const root = join(cache, "bundles");
  return folderNames(root).flatMap((id) =>
    folderNames(join(root, id))
      .filter((version) => isAbandoned(join(root, id, version), now))
      .map((version) => ({ id, version })),
  );
}

/** Library versions, per platform, with no completion marker and nothing written for more than a day. */
export function abandonedLibraries(cache: string, now: number): CachedLibraryVersion[] {
  const root = join(cache, "libraries");
  return folderNames(root).flatMap((id) =>
    folderNames(join(root, id)).flatMap((version) =>
      folderNames(join(root, id, version))
        .filter((platform) => isAbandoned(join(root, id, version, platform), now))
        .map((platform) => ({ id, version, platform })),
    ),
  );
}
