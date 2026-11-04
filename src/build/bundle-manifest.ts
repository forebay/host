import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { acceptsFileKey, acceptsItemId, acceptsVersion } from "../catalog/accepts.js";
import { isRecord } from "../plugins/is-record.js";
import { BuildRefusal } from "./build-refusal.js";
import { isModuleMarkerName } from "../cache/module-marker.js";

const MANIFEST_FILE = "plugin.json";
const DEFAULT_SOURCE = "src/index.ts";

/** The id, version and entry a `plugin.json` or `host.json` names, each in a shape a catalog accepts. */
export interface ItemManifest {
  path: string;
  id: string;
  version: string;
  /** The entry file, relative to the manifest's directory, with `/` separators. */
  entry: string;
}

/** What bundling a plugin repository needs from its `plugin.json`. */
export interface BundleManifest extends ItemManifest {
  /** The source bundled into `entry`, relative to the repository. */
  source: string;
  installMethod?: string;
}

export function parsedManifest(path: string): Record<string, unknown> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
      throw new BuildRefusal(`${path} could not be read as JSON: ${(error as Error).message}`, "write the manifest as a JSON object");
  }
  if (isRecord(manifest)) return manifest;
  throw new BuildRefusal(`${path} does not hold a JSON object`, "write the manifest as a JSON object");
}

function idOf(manifest: Record<string, unknown>, path: string): string {
  const id = manifest.id;
  if (typeof id === "string" && acceptsItemId(id)) return id;
  throw new BuildRefusal(`${path} names the id ${JSON.stringify(id)}, which a catalog refuses`, "give the manifest an id of lowercase letters and digits joined by single hyphens");
}

export function versionOf(manifest: Record<string, unknown>, path: string): string {
  const version = manifest.version;
  if (version === undefined) throw new BuildRefusal(`${path} has no version`, 'add a version to the manifest, for example "version": "1.0.0"');
  if (typeof version === "string" && acceptsVersion(version)) return version;
  throw new BuildRefusal(
    `${path} names the version ${JSON.stringify(version)}, which the catalog's version pattern refuses`,
    "give the manifest a semver version such as 1.0.0 or 1.0.0-beta.1, with no trailing dot and no empty part",
  );
}

function isBundleOwnFile(entry: string): boolean {
  return entry.toLowerCase() === MANIFEST_FILE || isModuleMarkerName(entry);
}

function entryOf(manifest: Record<string, unknown>, path: string): string {
  const entry = manifest.entry;
  if (typeof entry !== "string" || !acceptsFileKey(entry)) {
    throw new BuildRefusal(
      `${path} names the entry ${JSON.stringify(entry)}, which is not a relative path inside the bundle`,
      'name the entry file in the manifest as a relative path with / separators, for example "entry": "index.js"',
    );
  }
  if (!isBundleOwnFile(entry)) return entry;
  throw new BuildRefusal(`${path} names the entry ${entry}, which the bundle's own ${MANIFEST_FILE} or package.json would replace`, 'name a script as the entry, for example "entry": "index.js"');
}

function sourceOf(manifest: Record<string, unknown>, repositoryRoot: string): string {
  const named = isRecord(manifest.bundle) ? manifest.bundle.entry : undefined;
  const source = typeof named === "string" && named !== "" ? named : DEFAULT_SOURCE;
  if (existsSync(join(repositoryRoot, source))) return source;
  throw new BuildRefusal(`${repositoryRoot} has no source entry ${source}`, `add ${DEFAULT_SOURCE}, or name the source to bundle in plugin.json's bundle.entry`);
}

/** The id and version a manifest names, for a bundle that has no entry: a loader's data-only `host.json`. */
export function readIdentifiedManifest(directory: string, fileName: string): Omit<ItemManifest, "entry"> & { fields: Record<string, unknown> } {
  const path = join(directory, fileName);
  if (!existsSync(path)) throw new BuildRefusal(`${directory} has no ${fileName}`, `give the directory the ${fileName} that names its id and version`);
  const fields = parsedManifest(path);
  return { path, id: idOf(fields, path), version: versionOf(fields, path), fields };
}

export function readItemManifest(directory: string, fileName: string): ItemManifest & { fields: Record<string, unknown> } {
  const manifest = readIdentifiedManifest(directory, fileName);
  return { ...manifest, entry: entryOf(manifest.fields, manifest.path) };
}

export function readBundleManifest(repositoryRoot: string): BundleManifest {
  const { fields, ...manifest } = readItemManifest(repositoryRoot, MANIFEST_FILE);
  const installMethod = typeof fields.installMethod === "string" && fields.installMethod !== "" ? { installMethod: fields.installMethod } : {};
  return { ...manifest, source: sourceOf(fields, repositoryRoot), ...installMethod };
}
