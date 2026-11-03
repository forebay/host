import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { BuildRefusal } from "./build-refusal.js";
import { parsedManifest, readItemManifest, versionOf } from "./bundle-manifest.js";
import type { BundleOutput } from "./bundle-plugin.js";

const LIBRARY_MANIFESTS = ["library.json", "package.json"];

function everyFile(directory: string): Record<string, string> {
  const relativePaths = readdirSync(directory, { recursive: true, encoding: "utf8" }).sort();
  const files = relativePaths.filter((path) => statSync(join(directory, path)).isFile());
  return Object.fromEntries(files.map((path) => [path.split(sep).join("/"), join(directory, path)]));
}

/** A directory `forebay-host bundle` wrote: its `plugin.json` and the entry it names, and nothing else beside them. */
export function pluginDirectoryOutput(directory: string): BundleOutput {
  const root = resolve(directory);
  const manifest = readItemManifest(root, "plugin.json");
  const entry = join(root, manifest.entry);
  if (!existsSync(entry)) throw new BuildRefusal(`${root} has no ${manifest.entry}, the entry its plugin.json names`, "bundle the plugin into this directory first");
  return { id: manifest.id, version: manifest.version, files: { [manifest.entry]: entry, "plugin.json": manifest.path } };
}

/** A host bundle directory: every file in it, its id and version from `host.json`. */
export function hostDirectoryOutput(directory: string): BundleOutput {
  const root = resolve(directory);
  const manifest = readItemManifest(root, "host.json");
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
