import type { Fetcher } from "../cache/fetcher.js";
import type { Catalog } from "../catalog/catalog.js";
import type { HostPlaces } from "../context/places.js";
import { readInstalledStandard } from "../loader/installed-standard.js";
import type { LoaderApplication, LoaderStandard } from "../loader/standard.js";
import { isRecord } from "../plugins/is-record.js";
import { registerHost } from "../registration.js";
import { readHostReferences, recordReferences } from "../updates/references.js";
import { openRuntime } from "../runtime/open.js";
import type { Runtime, RuntimeSource } from "../runtime/open.js";
import { catalogProvenance, ownHostHome } from "./forebay-host.js";
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

function messageOf(error: unknown): { detail: string; fix: string } {
  const { detail, fix } = isRecord(error) ? (error as { detail?: unknown; fix?: unknown }) : {};
  return {
    detail: typeof detail === "string" ? detail : (error as Error).message,
    fix: typeof fix === "string" ? fix : "correct what the detail names, then install again",
  };
}

/** @implNote Keeps what the host scheduled for its next start, so recording the registered version never forgets an update already fetched. */
function recordRegisteredVersion(state: string, hostId: string, version: string): void {
  const recorded = readHostReferences(state, hostId);
  recordReferences(state, hostId, { ...recorded, run: { ...recorded.run, [hostId]: version } });
}

function registerLoader(runtime: Runtime, options: InstallLoadersOptions, loader: CatalogLoader, version: string, pathCommands: LoaderStandard["pathCommands"]): LoaderReport {
  const { places, environment } = options;
  const identity = loaderIdentity({ id: loader.id, version, application: loader.application, pathCommands, cache: places.cache, environment });
  const registered = registerHost(runtime, places, identity, catalogProvenance(places.cache, loader.id, version, new Date()), environment);
  recordRegisteredVersion(places.state, loader.id, version);
  return { id: loader.id, application: loader.application.id, home: identity.home, commands: registered.commands, refusedCommands: registered.refusedCommands };
}

/** Registers one installed loader, answering the background hosts it names once it is registered. */
function registerInstalled(runtime: Runtime, options: InstallLoadersOptions, report: InstallReport, loader: CatalogLoader, version: string): string[] {
  const standard = readInstalledStandard(options.places.cache, loader.id, version);
  if (typeof standard === "string") {
    report.unavailable.push({ id: loader.id, detail: standard, fix: "reinstall the loader from a catalog that lists a valid host.json" });
    return [];
  }
  try {
    report.loaders.push(registerLoader(runtime, options, loader, version, standard.pathCommands));
    return standard.background;
  } catch (error) {
    report.unavailable.push({ id: loader.id, ...messageOf(error) });
    return [];
  }
}

/** @implNote A background host loads into no application, so it writes nothing onto the PATH and reads no environment to register. */
function registerBackgroundHost(runtime: Runtime, places: HostPlaces, hostId: string, version: string): void {
  const identity = { id: hostId, version, home: ownHostHome(places, hostId), requiresCommand: false, commands: [] };
  registerHost(runtime, places, identity, catalogProvenance(places.cache, hostId, version, new Date()), {});
  recordRegisteredVersion(places.state, hostId, version);
}

/** Installs and registers every background host the registered loaders name; one the catalog lacks is reported under `unavailable`. */
async function installBackgroundHosts(runtime: Runtime, options: InstallLoadersOptions, report: InstallReport, background: readonly string[]): Promise<void> {
  const ids = [...new Set(background)];
  const installed = await installItems(options.catalog, ids.map((id) => ({ id })), "host", options.places.cache, options.fetcher, report);
  for (const [hostId, version] of Object.entries(installed)) {
    try {
      registerBackgroundHost(runtime, options.places, hostId, version);
    } catch (error) {
      report.unavailable.push({ id: hostId, ...messageOf(error) });
    }
  }
}

/**
 * Installs the loader bundle of every application the report calls installed or detected and
 * registers each as a host of its own, requesting the commands its `host.json` asks for, then
 * installs and registers every background host a registered loader names.
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
    const background = loaders.flatMap((loader) => {
      const version = installed[loader.id];
      return version === undefined ? [] : registerInstalled(runtime, options, report, loader, version);
    });
    await installBackgroundHosts(runtime, options, report, background);
  } finally {
    runtime.close();
  }
}
