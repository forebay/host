import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { LoaderApplication } from "../loader/standard.js";
import { BuildRefusal } from "./build-refusal.js";
import { parsedManifest, readIdentifiedManifest, readItemManifest, versionOf } from "./bundle-manifest.js";
import type { BundleOutput } from "./bundle-plugin.js";
import { requireLoaderStandard } from "./loader-standard-check.js";
import { moduleMarkerKey } from "../cache/module-marker.js";

const LIBRARY_MANIFESTS = ["library.json", "package.json"];
const HOST_MANIFEST = "host.json";

function everyFile(directory: string): Record<string, string> {
  const relativePaths = readdirSync(directory, { recursive: true, encoding: "utf8" }).sort();
  const files = relativePaths.filter((path) => statSync(join(directory, path)).isFile());
  return Object.fromEntries(files.map((path) => [path.split(sep).join("/"), join(directory, path)]));
}

function bundledFile(root: string, key: string): string {
  const path = join(root, key);
  if (existsSync(path)) return path;
  throw new BuildRefusal(`${root} has no ${key}, which its plugin.json's entry calls for`, "bundle the plugin into this directory first");
}

/** A directory `forebay-host bundle` wrote: its `plugin.json`, the entry it names and that entry's module marker, and nothing else beside them. */
export function pluginDirectoryOutput(directory: string): BundleOutput {
  const root = resolve(directory);
  const manifest = readItemManifest(root, "plugin.json");
  const keys = [manifest.entry, moduleMarkerKey(manifest.entry)].filter((key): key is string => key !== undefined);
  const files = Object.fromEntries(keys.map((key) => [key, bundledFile(root, key)]));
  return { id: manifest.id, version: manifest.version, files: { ...files, "plugin.json": manifest.path } };
}

function loaderDirectoryOutput(root: string): BundleOutput {
  const manifest = readIdentifiedManifest(root, HOST_MANIFEST);
  requireLoaderStandard(manifest.fields, manifest.path);
  const files = everyFile(root);
  const beside = Object.keys(files).filter((key) => key !== HOST_MANIFEST);
  if (beside.length > 0) {
    throw new BuildRefusal(`${root} is a loader bundle, which holds only ${HOST_MANIFEST}, but it also holds ${beside.join(", ")}`, "bundle the loader with forebay-host bundle-loader into an empty directory");
  }
  return { id: manifest.id, version: manifest.version, files, application: manifest.fields.application as LoaderApplication };
}

/**
 * A host bundle directory: every file in it with its id and version from `host.json`, or for a
 * loader, whose `host.json` declares an `application`, that one data-only file and the application.
 */
export function hostDirectoryOutput(directory: string): BundleOutput {
  const root = resolve(directory);
  if (readIdentifiedManifest(root, HOST_MANIFEST).fields.application !== undefined) return loaderDirectoryOutput(root);
  const manifest = readItemManifest(root, HOST_MANIFEST);
  return { id: manifest.id, version: manifest.version, files: everyFile(root) };
}

/** A library directory for one platform: every file in it, its version from `library.json`, else `package.json`. */
export function libraryDirectoryOutput(id: string, directory: string): BundleOutput {
  const root = resolve(directory);
  const manifestName = LIBRARY_MANIFESTS.find((name) => existsSync(join(root, name)));
  if (manifestName === undefined) throw new BuildRefusal(`${root} has neither ${LIBRARY_MANIFESTS.join(" nor ")}`, "give the library directory a manifest naming its version");
  const path = join(root, manifestName);
  return { id, version: versionOf(parsedManifest(path), path), files: everyFile(root) };
}
