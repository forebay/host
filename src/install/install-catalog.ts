import type { Catalog } from "../catalog/catalog.js";
import type { CatalogSource } from "../catalog/sources.js";
import { checkCatalog } from "../updates/check.js";
import { currentCatalogs } from "../updates/current-catalogs.js";
import { defaultCatalogTransport } from "../updates/transport.js";
import type { InstallReport } from "./install-report.js";

/** @implNote An install is asked for, so it checks every source now rather than waiting out the update interval. */
const CHECK_NOW_HOURS = 0;

/** Checks every source into the cache and answers their merged catalog; a source that fails is reported as `catalog`. */
export async function installCatalog(sources: readonly CatalogSource[], cache: string, report: InstallReport): Promise<Catalog> {
  const transport = defaultCatalogTransport();
  for (const source of sources) {
    const check = await checkCatalog(source, cache, new Date(), CHECK_NOW_HOURS, transport);
    if (check.kind === "failed") report.unavailable.push({ id: "catalog", detail: check.detail, fix: "check the catalog path or url, then install again" });
  }
  return currentCatalogs(sources, cache);
}
