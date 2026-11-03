import { readdirSync } from "node:fs";
import { join } from "node:path";
import { hasCompletionMarker } from "../cache/install-marker.js";

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

/**
 * Each bundle id's versions in the cache whose install completed, read from the folder names on disk.
 *
 * @remarks Files are not re-hashed here; a damaged version is found when the bundle source locates it.
 */
export function installedVersions(cache: string): Record<string, string[]> {
  const root = join(cache, "bundles");
  const installed: Record<string, string[]> = {};
  for (const id of folderNames(root)) {
    const versions = folderNames(join(root, id)).filter((version) => hasCompletionMarker(join(root, id, version)));
    if (versions.length > 0) installed[id] = versions;
  }
  return installed;
}
