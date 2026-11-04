import type { Fetcher } from "../cache/fetcher.js";
import { writeApplicationEntry } from "../entries/apply-entry.js";
import type { EntryLoader } from "../entries/entry-change.js";
import type { Catalog } from "../catalog/catalog.js";
import type { HostPlaces } from "../context/places.js";
import { readInstalledStandard } from "../loader/installed-standard.js";
import type { LoaderApplication, LoaderStandard } from "../loader/standard.js";
import { isRecord } from "../plugins/is-record.js";
import { registerHost } from "../registration.js";
import { recordRunningVersion } from "../updates/references.js";
import { openRuntime } from "../runtime/open.js";
import type { Runtime, RuntimeSource } from "../runtime/open.js";
import { catalogProvenance, ownHostHome } from "./forebay-host.js";
import { installItems } from "./install-items.js";
import { provenanceOf, storedApplicationProvenance } from "./application-provenance.js";
import type { ApplicationProvenance } from "./application-provenance.js";
import type { ApplicationOrigin, InstallReport, LoaderReport } from "./install-report.js";
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

/**
 * @implNote An entry that cannot be written is a line of the loader's report, never a failure of the
 * loader: its registration and commands already stand, and the launcher starts it without the entry.
 */
function entryOf(runtime: Runtime, places: HostPlaces, loader: EntryLoader): LoaderReport["entry"] {
  try {
    const entry = writeApplicationEntry(runtime, places, loader);
    return entry.written ? { written: true } : { written: false, detail: entry.detail, fix: entry.fix };
  } catch (error) {
    return { written: false, ...messageOf(error) };
  }
}

/** @implNote The first registration wins, so a later install never rewrites how the application was first found or installed. */
function provenanceToRecord(runtime: Runtime, options: InstallLoadersOptions, loader: CatalogLoader, home: string, origin: ApplicationOrigin | undefined): ApplicationProvenance | undefined {
  const stored = storedApplicationProvenance(runtime, options.places, loader.id);
  if (stored !== undefined || origin === undefined) return stored;
  return provenanceOf({ origin, application: loader.application, home, environment: options.environment, now: new Date() });
}

function registerLoader(
  runtime: Runtime,
  options: InstallLoadersOptions,
  loader: CatalogLoader,
  version: string,
  pathCommands: LoaderStandard["pathCommands"],
  origin: ApplicationOrigin | undefined,
): LoaderReport {
  const { places, environment } = options;
  const unrecorded = loaderIdentity({ id: loader.id, version, application: loader.application, pathCommands, cache: places.cache, environment });
  const provenance = provenanceToRecord(runtime, options, loader, unrecorded.home, origin);
  const identity = provenance === undefined ? unrecorded : { ...unrecorded, application: { ...unrecorded.application, provenance } };
  const registered = registerHost(runtime, places, identity, catalogProvenance(places.cache, loader.id, version, new Date()), environment);
  recordRunningVersion(places.state, loader.id, version);
  return {
    id: loader.id,
    application: loader.application.id,
    home: identity.home,
    commands: registered.commands,
    refusedCommands: registered.refusedCommands,
    entry: entryOf(runtime, places, { id: loader.id, application: loader.application, home: identity.home }),
  };
}

/** Registers one installed loader, answering the background hosts it names once it is registered. */
function registerInstalled(runtime: Runtime, options: InstallLoadersOptions, report: InstallReport, loader: CatalogLoader, version: string): string[] {
  const standard = readInstalledStandard(options.places.cache, loader.id, version);
  if (typeof standard === "string") {
    report.unavailable.push({ id: loader.id, detail: standard, fix: "reinstall the loader from a catalog that lists a valid host.json" });
    return [];
  }
  try {
    report.loaders.push(registerLoader(runtime, options, loader, version, standard.pathCommands, report.applications.find(({ id }) => id === loader.application.id)?.origin));
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
  recordRunningVersion(places.state, hostId, version);
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
 * registers each as a host of its own, requesting the commands its `host.json` asks for and writing
 * the entry its application starts the host through without the launcher, then
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
