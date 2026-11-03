import { currentPlatformKey } from "@weivel/typescript/host";
import type { Fetcher } from "../cache/fetcher.js";
import { checkInstalled } from "../cache/install-marker.js";
import type { Catalog } from "../catalog/catalog.js";
import type { CatalogSource } from "../catalog/sources.js";
import { libraryDirectory } from "../runtime/cached-runtime.js";
import type { HostLibraries } from "../runtime/cached-runtime.js";
import { FOREBAY_HOST_ID } from "./forebay-host.js";
import { bootLibraries, KOFFI_ID, RUNTIME_ID } from "./host-libraries.js";
import { installCatalog } from "./install-catalog.js";
import { installItems } from "./install-items.js";
import { emptyReport } from "./install-report.js";
import type { InstallReport } from "./install-report.js";

/** The catalog an install reads, and the runtime and koffi it can load to read the settings. */
export interface Bootstrap {
  catalog: Catalog;
  libraries: HostLibraries | undefined;
  report: InstallReport;
}

function isIntact(cache: string, libraries: HostLibraries, platformKey: string): boolean {
  return [
    libraryDirectory(cache, RUNTIME_ID, libraries.runtime, platformKey),
    libraryDirectory(cache, KOFFI_ID, libraries.koffi, platformKey),
  ].every((directory) => checkInstalled(directory).kind === "intact");
}

/**
 * Reads the catalog into the cache and makes sure a runtime and koffi are there to load, installing
 * the catalog's `latest` of both when none is, or when the installed one is damaged.
 *
 * @remarks Pins are honoured once the settings can be read, which needs this runtime first.
 */
export async function bootstrapLibraries(sources: readonly CatalogSource[], cache: string, fetcher: Fetcher): Promise<Bootstrap> {
  const report = emptyReport();
  const catalog = await installCatalog(sources, cache, report);
  const platformKey = currentPlatformKey();
  const present = bootLibraries(cache, FOREBAY_HOST_ID, platformKey);
  if (present !== undefined && isIntact(cache, present, platformKey)) return { catalog, libraries: present, report };
  await installItems(catalog, [{ id: RUNTIME_ID }, { id: KOFFI_ID }], "library", cache, fetcher, report);
  return { catalog, libraries: bootLibraries(cache, FOREBAY_HOST_ID, platformKey), report };
}
