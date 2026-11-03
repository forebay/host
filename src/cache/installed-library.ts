import { readdirSync } from "node:fs";
import { join } from "node:path";
import { newestVersion } from "../updates/semver.js";
import { hasCompletionMarker } from "./install-marker.js";

function versionNames(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** The newest version of library `id` whose install for `platformKey` completed in the cache, if any. */
export function newestInstalledLibrary(cache: string, id: string, platformKey: string): string | undefined {
  const root = join(cache, "libraries", id);
  return newestVersion(versionNames(root).filter((version) => hasCompletionMarker(join(root, version, platformKey))));
}
