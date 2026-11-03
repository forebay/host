import { readdirSync } from "node:fs";
import { join } from "node:path";
import { hasCompletionMarker } from "./install-marker.js";

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

/** Each platform key with at least one library version installed in the cache. */
export function libraryPlatforms(cache: string): string[] {
  const root = join(cache, "libraries");
  const platforms = folderNames(root).flatMap((id) => folderNames(join(root, id)).flatMap((version) => folderNames(join(root, id, version))));
  return [...new Set(platforms)].sort();
}

/**
 * Each library id's versions whose install for `platformKey` completed, read from the folder names on disk.
 *
 * @remarks Files are not re-hashed here; a library is verified before it is loaded.
 */
export function installedLibraries(cache: string, platformKey: string): Record<string, string[]> {
  const root = join(cache, "libraries");
  const installed: Record<string, string[]> = {};
  for (const id of folderNames(root)) {
    const versions = folderNames(join(root, id)).filter((version) => hasCompletionMarker(join(root, id, version, platformKey)));
    if (versions.length > 0) installed[id] = versions;
  }
  return installed;
}
