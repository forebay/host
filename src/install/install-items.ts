import type { Fetcher } from "../cache/fetcher.js";
import { installVersion } from "../cache/install-version.js";
import type { Catalog, CatalogItem } from "../catalog/catalog.js";
import { recordAnswer } from "./install-report.js";
import type { InstallReport } from "./install-report.js";

/** One item to install, at `version` when it names one (refused when the catalog does not list it), else at the catalog's `latest`. */
export interface InstallTarget {
  id: string;
  version?: string;
}

/** `ids` as targets, each held to the pin `pins` gives it. */
export function pinnedTargets(ids: readonly string[], pins: Record<string, string>): InstallTarget[] {
  return ids.map((id) => (Object.hasOwn(pins, id) ? { id, version: pins[id] as string } : { id }));
}

function itemOf(catalog: Catalog, id: string): CatalogItem | undefined {
  return Object.hasOwn(catalog.items, id) ? catalog.items[id] : undefined;
}

function versionFor(item: CatalogItem, target: InstallTarget): string {
  return target.version ?? item.latest;
}

async function installOne(catalog: Catalog, target: InstallTarget, kind: CatalogItem["kind"], cache: string, fetcher: Fetcher, report: InstallReport): Promise<string | undefined> {
  const item = itemOf(catalog, target.id);
  if (item === undefined || item.kind !== kind) {
    report.unavailable.push({ id: target.id, detail: `no catalog source lists a ${kind} ${target.id}`, fix: "add a catalog source that lists it, or leave it out" });
    return undefined;
  }
  const answer = await installVersion(cache, target.id, item, versionFor(item, target), fetcher);
  recordAnswer(report, answer);
  return answer.ok ? answer.version : undefined;
}

/** Installs each target of `kind` into the cache in turn, answering the version of every one that is now installed. */
export async function installItems(
  catalog: Catalog,
  targets: readonly InstallTarget[],
  kind: CatalogItem["kind"],
  cache: string,
  fetcher: Fetcher,
  report: InstallReport,
): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  for (const target of targets) {
    const version = await installOne(catalog, target, kind, cache, fetcher, report);
    if (version !== undefined) versions[target.id] = version;
  }
  return versions;
}
