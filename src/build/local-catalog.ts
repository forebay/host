import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { INSTALL_MARKER } from "../cache/install-marker.js";
import { isPlatformKey } from "../cache/platform-key.js";
import { sha256Of } from "../cache/sha256.js";
import { acceptsFileKey, acceptsItemId, acceptsVersion } from "../catalog/accepts.js";
import type { Catalog, CatalogItem, CatalogVersion, FileRef } from "../catalog/catalog.js";
import { newestVersion } from "../updates/semver.js";
import { BuildRefusal } from "./build-refusal.js";
import type { BundleOutput } from "./bundle-plugin.js";

const CATALOG_FILE = "catalog.json";
const FILES_DIRECTORY = "files";

/** One built item for a local catalog, per platform when `platform` names one. */
export interface CatalogInput {
  kind: CatalogItem["kind"];
  output: BundleOutput;
  platform?: string;
}

function labelOf(input: CatalogInput): string {
  return `${input.output.id}@${input.output.version}${input.platform === undefined ? "" : ` for ${input.platform}`}`;
}

/** @implNote Compared without case, as the installer compares it, since Windows and macOS file systems would let one replace the other. */
function isInstallMarker(key: string): boolean {
  return key.toLowerCase() === INSTALL_MARKER.toLowerCase();
}

function checkInput(input: CatalogInput): void {
  const { id, version, files } = input.output;
  if (!acceptsItemId(id)) throw new BuildRefusal(`${JSON.stringify(id)} is not an id a catalog accepts`, "use lowercase letters and digits joined by single hyphens");
  if (!acceptsVersion(version)) throw new BuildRefusal(`${id} has the version ${JSON.stringify(version)}, which a catalog refuses`, "use a semver version such as 1.0.0, with no trailing dot");
  if (input.platform !== undefined && !isPlatformKey(input.platform)) {
    throw new BuildRefusal(`${labelOf(input)} names a platform that is not an <os>-<arch> key`, "name the platform as Node spells it, for example linux-x64");
  }
  const refusedKey = Object.keys(files).find((key) => !acceptsFileKey(key));
  if (refusedKey !== undefined) throw new BuildRefusal(`${labelOf(input)} lists the file ${JSON.stringify(refusedKey)}, which a catalog refuses`, "give every file a relative path with / separators and no . or .. segment");
  const markerKey = Object.keys(files).find(isInstallMarker);
  if (markerKey !== undefined) throw new BuildRefusal(`${labelOf(input)} lists the file ${markerKey}, which the cache would take for its completion marker ${INSTALL_MARKER}`, "rename the file");
}

function slotOf(input: CatalogInput): string {
  return JSON.stringify([input.output.id, input.output.version, input.platform ?? null]);
}

function checkConsistent(inputs: CatalogInput[]): void {
  const kinds = new Map<string, CatalogItem["kind"]>();
  const slots = new Set<string>();
  for (const input of inputs) {
    const kind = kinds.get(input.output.id) ?? input.kind;
    if (kind !== input.kind) throw new BuildRefusal(`${input.output.id} is given both as a ${kind} and as a ${input.kind}`, "give each id one kind");
    if (slots.has(slotOf(input))) throw new BuildRefusal(`${labelOf(input)} is given twice`, "give each version of an item, per platform, once");
    kinds.set(input.output.id, kind);
    slots.add(slotOf(input));
  }
}

function segmentsOf(input: CatalogInput): string[] {
  return [FILES_DIRECTORY, input.output.id, input.output.version, ...(input.platform === undefined ? [] : [input.platform])];
}

function placeFile(source: string, outDirectory: string, segments: string[]): FileRef {
  const destination = join(outDirectory, ...segments);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  const bytes = readFileSync(destination);
  return { url: segments.map(encodeURIComponent).join("/"), sha256: sha256Of(bytes), size: bytes.length };
}

function placeFiles(input: CatalogInput, outDirectory: string): Record<string, FileRef> {
  const prefix = segmentsOf(input);
  return Object.fromEntries(Object.entries(input.output.files).map(([key, source]) => [key, placeFile(source, outDirectory, [...prefix, ...key.split("/")])]));
}

function addFiles(version: CatalogVersion, input: CatalogInput, files: Record<string, FileRef>): void {
  if (input.platform === undefined) {
    version.files = files;
    return;
  }
  version.platforms = { ...version.platforms, [input.platform]: { files } };
}

function itemFor(items: Catalog["items"], input: CatalogInput): CatalogItem {
  const item = items[input.output.id] ?? { kind: input.kind, versions: {}, latest: input.output.version };
  items[input.output.id] = item;
  return item;
}

function withLatest(items: Catalog["items"]): Catalog["items"] {
  for (const item of Object.values(items)) item.latest = newestVersion(Object.keys(item.versions)) as string;
  return items;
}

/**
 * Copies each output under `<outDirectory>/files/<id>/<version>/[<platform>/]` and writes
 * `<outDirectory>/catalog.json` listing them by relative url, answering the index's path.
 *
 * @remarks Every input is checked before anything is copied. Relative urls resolve against the
 * index, so the catalog's file source accepts them wherever the directory is mounted.
 */
export function buildLocalCatalog(inputs: CatalogInput[], outDirectory: string): string {
  inputs.forEach(checkInput);
  checkConsistent(inputs);
  const out = resolve(outDirectory);
  const items: Catalog["items"] = {};
  for (const input of inputs) {
    const item = itemFor(items, input);
    const version = (item.versions[input.output.version] ??= {});
    addFiles(version, input, placeFiles(input, out));
  }
  const catalog: Catalog = { format: 1, items: withLatest(items) };
  const catalogPath = join(out, CATALOG_FILE);
  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalogPath;
}
