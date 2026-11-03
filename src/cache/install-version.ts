import { resolve } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import type { CatalogItem, CatalogVersion, FileRef } from "../catalog/catalog.js";
import { CacheRefusal } from "./cache-refusal.js";
import type { Fetcher } from "./fetcher.js";
import { INSTALL_MARKER, writeInstallMarker } from "./install-marker.js";
import { storeFile } from "./store.js";
import { isStrictlyInside } from "./strictly-inside.js";

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

function versionOf(item: CatalogItem, version: string): CatalogVersion {
  if (Object.hasOwn(item.versions, version)) return item.versions[version] as CatalogVersion;
  throw new PlacementRefusal(`the catalog lists no version ${version}`, "install a version the catalog lists");
}

function platformFiles(entry: CatalogVersion, platformKey: string): Record<string, FileRef> {
  if (entry.platforms === undefined) return {};
  if (Object.hasOwn(entry.platforms, platformKey)) return (entry.platforms[platformKey] as { files: Record<string, FileRef> }).files;
  throw new PlacementRefusal(`not built for ${platformKey}`, `use a platform the item lists, or ask its publisher for a ${platformKey} build`);
}

function filesOf(entry: CatalogVersion, platformKey: string): Record<string, FileRef> {
  const shared = entry.files ?? {};
  const perPlatform = platformFiles(entry, platformKey);
  const ambiguous = Object.keys(perPlatform).find((key) => Object.hasOwn(shared, key));
  if (ambiguous === undefined) return { ...shared, ...perPlatform };
  throw new PlacementRefusal(
    `file ${ambiguous} is listed both for every platform and for ${platformKey}, so which one to install is ambiguous`,
    "list each file once, either for every platform or per platform",
    ambiguous,
  );
}

/** @implNote Compared without case, since Windows and macOS file systems would let `.INSTALLED.json` overwrite the marker. */
function isMarkerPath(directory: string, destination: string): boolean {
  return destination.toLowerCase() === resolve(directory, INSTALL_MARKER).toLowerCase();
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
    if (isMarkerPath(directory, destination)) {
      throw new PlacementRefusal(`file ${key} would replace the cache's completion marker ${INSTALL_MARKER}`, "rename the file in the catalog entry", key);
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
  const files = filesOf(entry, platformKey);
  const directory = versionDirectory(cache, id, item, version, platformKey);
  return { directory, placements: placementsOf(directory, files) };
}

/** @implNote Written only after every file is stored and verified, so a refusal midway leaves no runnable version. */
async function markComplete(installed: InstalledVersion, plan: InstallPlan): Promise<InstalledVersion | InstallRefusal> {
  const hashes = Object.fromEntries(plan.placements.map((placement) => [placement.key, placement.reference.sha256]));
  try {
    await writeInstallMarker(plan.directory, hashes);
  } catch (error) {
    return refusalOf(installed.id, installed.version, error, INSTALL_MARKER);
  }
  return installed;
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
  return markComplete(installed, plan);
}

/**
 * Fetches one version of a catalog item into its place in the cache, verifying every file.
 *
 * @remarks Plugins and hosts go to `<cache>/bundles/<id>/<version>/`, libraries to
 * `<cache>/libraries/<id>/<version>/<platform>/`. Every destination is checked before anything is
 * written, and the version's completion marker is written last.
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
