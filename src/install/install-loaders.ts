import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetcher } from "../cache/fetcher.js";
import type { Catalog } from "../catalog/catalog.js";
import type { HostPlaces } from "../context/places.js";
import { checkLoaderStandard } from "../loader/standard.js";
import type { LoaderApplication, LoaderStandard } from "../loader/standard.js";
import { isRecord } from "../plugins/is-record.js";
import { registerHost } from "../registration.js";
import { openRuntime } from "../runtime/open.js";
import type { Runtime, RuntimeSource } from "../runtime/open.js";
import { catalogProvenance } from "./forebay-host.js";
import { installItems } from "./install-items.js";
import type { InstallReport, LoaderReport } from "./install-report.js";
import { loaderIdentity } from "./loader-identity.js";

const REGISTERED_STATES = new Set(["installed", "detected"]);

export interface InstallLoadersOptions {
  catalog: Catalog;
  places: HostPlaces;
  runtimeSource: RuntimeSource;
  fetcher: Fetcher;
  environment: Record<string, string>;
  /** The host bundle running this install, which every loader's commands start. */
  hostBundleFile: string;
}

interface CatalogLoader {
  id: string;
  application: LoaderApplication;
}

function loadersFor(catalog: Catalog, applicationIds: ReadonlySet<string>): CatalogLoader[] {
  return Object.entries(catalog.items).flatMap(([id, item]) =>
    item.kind === "host" && item.application !== undefined && applicationIds.has(item.application.id) ? [{ id, application: item.application }] : [],
  );
}

/** @implNote Read from the installed bundle, since the catalog carries only the application. */
function readPathCommands(cache: string, id: string, version: string): LoaderStandard["pathCommands"] | string {
  const file = join(cache, "bundles", id, version, "host.json");
  try {
    const manifest: unknown = JSON.parse(readFileSync(file, "utf8"));
    const issue = checkLoaderStandard(manifest)[0];
    return issue === undefined ? (manifest as LoaderStandard).pathCommands : `${file} is not a loader standard: ${issue.path} ${issue.detail}`;
  } catch (error) {
    return `${file} could not be read: ${(error as Error).message}`;
  }
}

function messageOf(error: unknown): { detail: string; fix: string } {
  const { detail, fix } = isRecord(error) ? (error as { detail?: unknown; fix?: unknown }) : {};
  return {
    detail: typeof detail === "string" ? detail : (error as Error).message,
    fix: typeof fix === "string" ? fix : "correct what the detail names, then install again",
  };
}

function registerLoader(runtime: Runtime, options: InstallLoadersOptions, loader: CatalogLoader, version: string, pathCommands: LoaderStandard["pathCommands"]): LoaderReport {
  const { places, environment, hostBundleFile } = options;
  const identity = loaderIdentity({ id: loader.id, version, application: loader.application, pathCommands, hostBundleFile, environment });
  const registered = registerHost(runtime, places, identity, catalogProvenance(places.cache, loader.id, version, new Date()), environment);
  return { id: loader.id, application: loader.application.id, home: identity.home, commands: registered.commands, refusedCommands: registered.refusedCommands };
}

function registerInstalled(runtime: Runtime, options: InstallLoadersOptions, report: InstallReport, loader: CatalogLoader, version: string): void {
  const pathCommands = readPathCommands(options.places.cache, loader.id, version);
  if (typeof pathCommands === "string") {
    report.unavailable.push({ id: loader.id, detail: pathCommands, fix: "reinstall the loader from a catalog that lists a valid host.json" });
    return;
  }
  try {
    report.loaders.push(registerLoader(runtime, options, loader, version, pathCommands));
  } catch (error) {
    report.unavailable.push({ id: loader.id, ...messageOf(error) });
  }
}

/**
 * Installs the loader bundle of every application the report calls installed or detected and
 * registers each as a host of its own, requesting the commands its `host.json` asks for.
 *
 * @remarks An application with no loader in the catalog gets none. A loader that cannot be
 * installed or registered is reported under `unavailable` and the rest still register.
 */
export async function installLoaders(options: InstallLoadersOptions, report: InstallReport): Promise<void> {
  const ids = new Set(report.applications.filter(({ state }) => REGISTERED_STATES.has(state)).map(({ id }) => id));
  const loaders = loadersFor(options.catalog, ids);
  if (loaders.length === 0) return;
  const installed = await installItems(options.catalog, loaders.map(({ id }) => ({ id })), "host", options.places.cache, options.fetcher, report);
  const runtime = openRuntime(options.runtimeSource);
  try {
    for (const loader of loaders) {
      const version = installed[loader.id];
      if (version !== undefined) registerInstalled(runtime, options, report, loader, version);
    }
  } finally {
    runtime.close();
  }
}
