import { assertManifest, isPluginError, pluginError } from "@weivel/typescript/engine";
import type { PluginError } from "@weivel/typescript";
import type { DeployedPlugin, ManifestScan } from "@weivel/typescript/host";
import type { BundleEntry } from "./bundle-source.js";
import { readManifestFile } from "./manifest-file.js";

function refusalOf(entry: BundleEntry, error: unknown): PluginError {
  if (isPluginError(error)) return pluginError(entry.id, `${entry.manifestPath}: ${error.detail}`, error.fix);
  return pluginError(
    entry.id,
    `${entry.manifestPath} is not readable as JSON: ${String(error)}`,
    "install the plugin again so its plugin.json is written again",
  );
}

function mismatchOf(entry: BundleEntry, declaredId: string): PluginError {
  return pluginError(
    entry.id,
    `${entry.manifestPath}: plugin id "${declaredId}" does not match its bundle "${entry.id}"`,
    "install the plugin again so its bundle is filed under the id its plugin.json declares",
  );
}

function deployedOrRefusal(entry: BundleEntry, wellKnownServices: readonly string[]): DeployedPlugin | PluginError {
  try {
    const manifest = assertManifest(readManifestFile(entry.manifestPath), wellKnownServices);
    if (manifest.id !== entry.id) return mismatchOf(entry, manifest.id);
    return { manifest, manifestPath: entry.manifestPath, entryPath: entry.entryPath };
  } catch (error) {
    return refusalOf(entry, error);
  }
}

/** Validates each bundle's manifest as the engine's own directory scan does, keeping the order given. */
export function scanOf(entries: readonly BundleEntry[], wellKnownServices: readonly string[]): ManifestScan {
  const scan: ManifestScan = { loaded: [], failed: [] };
  for (const entry of entries) {
    const outcome = deployedOrRefusal(entry, wellKnownServices);
    if (isPluginError(outcome)) scan.failed.push(outcome);
    else scan.loaded.push(outcome);
  }
  return scan;
}
