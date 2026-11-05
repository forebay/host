import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isRecord } from "../plugins/is-record.js";
import { BuildRefusal } from "./build-refusal.js";

const MANIFEST_FILE = "plugin.json";
const DEFAULT_SOURCE = "src/index.ts";

/** What bundling a plugin repository needs from its `plugin.json`. */
export interface BundleManifest {
  path: string;
  fields: Record<string, unknown>;
  id: string;
  version: string;
  /** The entry file, relative to the manifest's directory, with `/` separators. */
  entry: string;
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
  if (typeof id === "string" && id !== "") return id;
  throw new BuildRefusal(`${path} names the id ${JSON.stringify(id)}`, "give the manifest an id of lowercase letters and digits joined by single hyphens");
}

export function versionOf(manifest: Record<string, unknown>, path: string): string {
  const version = manifest.version;
  if (typeof version === "string" && version !== "") return version;
  throw new BuildRefusal(`${path} has no version`, 'add a version to the manifest, for example "version": "1.0.0"');
}

/** @implNote Guards only this build's own write; which entries a catalog accepts is the catalog build's rule. */
function staysInside(entry: string): boolean {
  const root = resolve("bundle-root");
  const target = relative(root, join(root, entry));
  return !isAbsolute(entry) && !entry.includes("\\") && target !== "" && !target.startsWith("..") && !isAbsolute(target);
}

function entryOf(manifest: Record<string, unknown>, path: string): string {
  const entry = manifest.entry;
  if (typeof entry !== "string" || !staysInside(entry)) {
    throw new BuildRefusal(
      `${path} names the entry ${JSON.stringify(entry)}, which is not a relative path inside the bundle`,
      'name the entry file in the manifest as a relative path with / separators, for example "entry": "index.js"',
    );
  }
  return entry;
}

function sourceOf(manifest: Record<string, unknown>, repositoryRoot: string): string {
  const named = isRecord(manifest.bundle) ? manifest.bundle.entry : undefined;
  const source = typeof named === "string" && named !== "" ? named : DEFAULT_SOURCE;
  if (existsSync(join(repositoryRoot, source))) return source;
  throw new BuildRefusal(`${repositoryRoot} has no source entry ${source}`, `add ${DEFAULT_SOURCE}, or name the source to bundle in plugin.json's bundle.entry`);
}

export function readBundleManifest(repositoryRoot: string): BundleManifest {
  const path = join(repositoryRoot, MANIFEST_FILE);
  if (!existsSync(path)) throw new BuildRefusal(`${repositoryRoot} has no ${MANIFEST_FILE}`, `give the directory the ${MANIFEST_FILE} that names its id and version`);
  const fields = parsedManifest(path);
  const installMethod = typeof fields.installMethod === "string" && fields.installMethod !== "" ? { installMethod: fields.installMethod } : {};
  return { path, fields, id: idOf(fields, path), version: versionOf(fields, path), entry: entryOf(fields, path), source: sourceOf(fields, repositoryRoot), ...installMethod };
}
