import type { Fetcher } from "../cache/fetcher.js";
import type { Catalog } from "../catalog/catalog.js";
import type { CatalogSource } from "../catalog/sources.js";
import { FOREBAY_HOST_ID } from "./forebay-host.js";
import { installCatalog } from "./install-catalog.js";
import { installItems } from "./install-items.js";
import { emptyReport } from "./install-report.js";
import type { InstallReport } from "./install-report.js";

export const RUNTIME_ID = "runtime";
export const KOFFI_ID = "koffi";

/** What the host itself runs from the cache: its own bundle, the runtime and koffi, each by version. */
export interface Foundation {
  catalog: Catalog;
  versions: Record<string, string>;
  report: InstallReport;
}

/** Installs the host's own bundle, the runtime and koffi at the catalog's `latest`, needing no runtime to do it. */
export async function installFoundation(sources: readonly CatalogSource[], cache: string, fetcher: Fetcher): Promise<Foundation> {
  const report = emptyReport();
  const catalog = await installCatalog(sources, cache, report);
  const host = await installItems(catalog, [{ id: FOREBAY_HOST_ID }], "host", cache, fetcher, report);
  const libraries = await installItems(catalog, [{ id: RUNTIME_ID }, { id: KOFFI_ID }], "library", cache, fetcher, report);
  return { catalog, versions: { ...host, ...libraries }, report };
}
