import type { Catalog, CatalogItem } from "../catalog/catalog.js";
import type { EnabledPlugin } from "../plugins/enabled.js";
import { newestVersion } from "./semver.js";

export interface ResolvedVersions {
  run: Record<string, string>;
  fetch: Array<{ id: string; version: string }>;
}

function pluginItem(catalog: Catalog, id: string): CatalogItem | undefined {
  const item = Object.hasOwn(catalog.items, id) ? catalog.items[id] : undefined;
  return item?.kind === "plugin" ? item : undefined;
}

function installedOf(installed: Record<string, string[]>, id: string): string[] {
  return Object.hasOwn(installed, id) ? (installed[id] as string[]) : [];
}

/** @implNote The catalog's `latest` wins over a newer installed version, so a publisher can roll a broken release back. */
function unpinnedRun(item: CatalogItem | undefined, versions: string[]): string | undefined {
  if (item !== undefined && versions.includes(item.latest)) return item.latest;
  return newestVersion(versions);
}

function wanted(item: CatalogItem | undefined, plugin: EnabledPlugin): string | undefined {
  if (item === undefined) return undefined;
  const version = plugin.pin ?? item.latest;
  return Object.hasOwn(item.versions, version) ? version : undefined;
}

/**
 * Which installed version each enabled plugin runs this start, and which versions to fetch for the next.
 *
 * @remarks Only an installed version is ever chosen to run, so a fetch that fails or is still under
 * way never changes what runs; a fetched version switches on the next start (spec 7.2).
 */
export function resolveVersions(catalog: Catalog, enabled: EnabledPlugin[], installed: Record<string, string[]>): ResolvedVersions {
  const resolved: ResolvedVersions = { run: {}, fetch: [] };
  for (const plugin of enabled) {
    const item = pluginItem(catalog, plugin.id);
    const versions = installedOf(installed, plugin.id);
    const run = plugin.pin === undefined ? unpinnedRun(item, versions) : versions.includes(plugin.pin) ? plugin.pin : undefined;
    if (run !== undefined) resolved.run[plugin.id] = run;
    const next = wanted(item, plugin);
    if (next !== undefined && !versions.includes(next)) resolved.fetch.push({ id: plugin.id, version: next });
  }
  return resolved;
}
