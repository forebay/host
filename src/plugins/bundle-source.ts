import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readManifestFileOrNull } from "./manifest-file.js";

const MANIFEST_FILE = "plugin.json";
const UNDECLARED_VERSION = "0.0.0";

export interface BundleEntry {
  id: string;
  version: string;
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

/** @implNote A manifest that declares no `version` reads as 0.0.0, so it still lists and only a pin can refuse it. */
function versionOf(version: unknown): string {
  return typeof version === "string" && version !== "" ? version : UNDECLARED_VERSION;
}

function locateIn(root: string, id: string): BundleEntry | null {
  const folder = join(root, id);
  const manifestPath = join(folder, MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  const manifest = readManifestFileOrNull(manifestPath);
  return { id, version: versionOf(manifest?.version), manifestPath, entryPath: entryPathOf(folder, manifest?.entry) };
}

/** Bundles laid out as `<root>/<id>/plugin.json`, each with the entry its manifest names beside it. */
export function directoryBundles(root: string): BundleSource {
  const locate = (id: string) => locateIn(root, id);
  return {
    list: () => folderNames(root).flatMap((id) => locate(id) ?? []),
    locate,
  };
}
