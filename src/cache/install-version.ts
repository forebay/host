import { isAbsolute, relative, resolve, sep } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import type { CatalogItem, CatalogVersion, FileRef } from "../catalog/catalog.js";
import { CacheRefusal } from "./cache-refusal.js";
import type { Fetcher } from "./fetcher.js";
import { storeFile } from "./store.js";

const PLATFORM_KEY = /^[a-z0-9]+-[a-z0-9]+$/;

export interface InstalledVersion {
  ok: true;
  id: string;
  version: string;
  directory: string;
  fetched: string[];
  cached: string[];
}

export interface InstallRefusal {
  ok: false;
  id: string;
  version: string;
  detail: string;
  fix: string;
  file?: string;
}

interface Placement {
  key: string;
  reference: FileRef;
  destination: string;
}

interface InstallPlan {
  directory: string;
  placements: Placement[];
}

class PlacementRefusal extends Error {
  constructor(
    readonly detail: string,
    readonly fix: string,
    readonly file?: string,
  ) {
    super(detail);
  }
}

function isStrictlyInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function versionOf(item: CatalogItem, version: string): CatalogVersion {
  if (Object.hasOwn(item.versions, version)) return item.versions[version] as CatalogVersion;
  throw new PlacementRefusal(`the catalog lists no version ${version}`, "install a version the catalog lists");
}

function platformFiles(entry: CatalogVersion, platformKey: string): Record<string, FileRef> {
  if (entry.platforms === undefined) return {};
  if (Object.hasOwn(entry.platforms, platformKey)) return (entry.platforms[platformKey] as { files: Record<string, FileRef> }).files;
  throw new PlacementRefusal(`not built for ${platformKey}`, `use a platform the item lists, or ask its publisher for a ${platformKey} build`);
}

function assertPlatformKeyShape(platformKey: string): void {
  if (PLATFORM_KEY.test(platformKey)) return;
  throw new PlacementRefusal(`a platform key is <os>-<arch> as Node spells them, for example linux-x64, not ${platformKey}`, "pass the platform key the catalog names its builds by, or omit it");
}

function versionDirectory(cache: string, id: string, item: CatalogItem, version: string, platformKey: string): string {
  const root = resolve(cache, item.kind === "library" ? "libraries" : "bundles");
  const directory = item.kind === "library" ? resolve(root, id, version, platformKey) : resolve(root, id, version);
  if (isStrictlyInside(root, directory)) return directory;
  throw new PlacementRefusal(`${id}@${version} would be installed outside ${root}`, "use an item id and version the catalog schema accepts");
}

/**
 * @implNote The catalog schema already refuses escaping file keys; this resolves and checks them
 * again because `installVersion` takes any `CatalogItem`, not only one `readCatalog` produced.
 */
function placementsOf(directory: string, files: Record<string, FileRef>): Placement[] {
  return Object.entries(files).map(([key, reference]) => {
    const destination = resolve(directory, key);
    if (!isStrictlyInside(directory, destination)) {
      throw new PlacementRefusal(`file ${key} would be written outside ${directory}`, "remove the file from the catalog entry or give it a key inside the version", key);
    }
    return { key, reference, destination };
  });
}

function refusalOf(id: string, version: string, error: unknown, file?: string): InstallRefusal {
  if (error instanceof PlacementRefusal) return { ok: false, id, version, detail: error.detail, fix: error.fix, ...(error.file === undefined ? {} : { file: error.file }) };
  if (error instanceof CacheRefusal) return { ok: false, id, version, detail: error.detail, fix: error.fix, ...(file === undefined ? {} : { file }) };
  throw error;
}

function planInstall(cache: string, id: string, item: CatalogItem, version: string, platformKey: string): InstallPlan {
  assertPlatformKeyShape(platformKey);
  const entry = versionOf(item, version);
  const files = { ...entry.files, ...platformFiles(entry, platformKey) };
  const directory = versionDirectory(cache, id, item, version, platformKey);
  return { directory, placements: placementsOf(directory, files) };
}

async function storeAll(id: string, version: string, plan: InstallPlan, fetcher: Fetcher): Promise<InstalledVersion | InstallRefusal> {
  const installed: InstalledVersion = { ok: true, id, version, directory: plan.directory, fetched: [], cached: [] };
  for (const placement of plan.placements) {
    try {
      const answer = await storeFile(placement.reference, placement.destination, fetcher);
      installed[answer].push(placement.key);
    } catch (error) {
      return refusalOf(id, version, error, placement.key);
    }
  }
  return installed;
}

/**
 * Fetches one version of a catalog item into its place in the cache, verifying every file.
 *
 * @remarks Plugins and hosts go to `<cache>/bundles/<id>/<version>/`, libraries to
 * `<cache>/libraries/<id>/<version>/<platform>/`. Every destination is checked before anything is written.
 */
export async function installVersion(
  cache: string,
  id: string,
  item: CatalogItem,
  version: string,
  fetcher: Fetcher,
  platformKey: string = currentPlatformKey(),
): Promise<InstalledVersion | InstallRefusal> {
  let plan: InstallPlan;
  try {
    plan = planInstall(cache, id, item, version, platformKey);
  } catch (error) {
    return refusalOf(id, version, error);
  }
  return storeAll(id, version, plan, fetcher);
}
