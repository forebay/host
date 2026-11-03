import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkLoaderStandard } from "./standard.js";
import type { LoaderStandard } from "./standard.js";

/** Where the loader standard of host bundle `id` at `version` is installed in `cache`. */
export function installedStandardFile(cache: string, id: string, version: string): string {
  return join(cache, "bundles", id, version, "host.json");
}

/**
 * The loader standard the installed host bundle `id` at `version` carries, or why it has none.
 *
 * @implNote Read from the installed bundle, since the catalog and the registration carry only the application.
 */
export function readInstalledStandard(cache: string, id: string, version: string): LoaderStandard | string {
  const file = installedStandardFile(cache, id, version);
  try {
    const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
    const issue = checkLoaderStandard(manifest)[0];
    return issue === undefined ? (manifest as LoaderStandard) : `${file} is not a loader standard: ${issue.path} ${issue.detail}`;
  } catch (error) {
    return `${file} could not be read: ${(error as Error).message}`;
  }
}
