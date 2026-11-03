import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readManifestFileOrNull } from "./manifest-file.js";

const MANIFEST_FILE = "plugin.json";

export interface BundleEntry {
  id: string;
  /** Null when plugin.json declares no `version`, which the scan refuses rather than inventing one. */
  version: string | null;
  manifestPath: string;
  entryPath: string | null;
}

export interface BundleSource {
  list(): BundleEntry[];
  locate(id: string): BundleEntry | null;
}

function folderNames(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

function entryPathOf(folder: string, entry: unknown): string | null {
  if (typeof entry !== "string" || entry === "") return null;
  const entryPath = join(folder, entry);
  return existsSync(entryPath) ? entryPath : null;
}

function versionOf(version: unknown): string | null {
  return typeof version === "string" && version !== "" ? version : null;
}

/** The bundle whose `plugin.json` sits directly in `folder`, or null when there is none. */
export function bundleInFolder(folder: string, id: string): BundleEntry | null {
  const manifestPath = join(folder, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  const manifest = readManifestFileOrNull(manifestPath);
  return { id, version: versionOf(manifest?.version), manifestPath, entryPath: entryPathOf(folder, manifest?.entry) };
}

/** Bundles laid out as `<root>/<id>/plugin.json`, each with the entry its manifest names beside it. */
export function directoryBundles(root: string): BundleSource {
  const locate = (id: string) => bundleInFolder(join(root, id), id);
  return {
    list: () => folderNames(root).flatMap((id) => locate(id) ?? []),
    locate,
  };
}
