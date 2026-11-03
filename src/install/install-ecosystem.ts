import { currentPlatformKey } from "@weivel/typescript/host";
import { defaultFetcher } from "../cache/fetcher.js";
import type { Fetcher } from "../cache/fetcher.js";
import type { Catalog } from "../catalog/catalog.js";
import type { CatalogSource } from "../catalog/sources.js";
import type { HostPlaces } from "../context/places.js";
import { hostSettings } from "../host-settings.js";
import type { HostSettings } from "../host-settings.js";
import { enabledPlugins, pinnedVersions } from "../plugins/enabled.js";
import { isRecord } from "../plugins/is-record.js";
import { registerHost } from "../registration.js";
import type { HostLibraries } from "../runtime/cached-runtime.js";
import { openRuntime } from "../runtime/open.js";
import type { Runtime } from "../runtime/open.js";
import { recordReferences } from "../updates/references.js";
import { hostLibraryReferences } from "./boot-from-cache.js";
import { bootstrapLibraries } from "./bootstrap-libraries.js";
import type { Bootstrap } from "./bootstrap-libraries.js";
import { FOREBAY_HOST_ID, forebayHostIdentity, forebayHostProvenance } from "./forebay-host.js";
import { KOFFI_ID, RUNTIME_ID, verifiedRuntimeSource } from "./host-libraries.js";
import { installItems, pinnedTargets } from "./install-items.js";
import type { InstallTarget } from "./install-items.js";
import { emptyReport, mergeReports } from "./install-report.js";
import type { InstallReport } from "./install-report.js";
import { recordCatalogSources } from "./record-catalog-sources.js";

const PORTABLE = "portable";
const FOUNDATION_IDS = new Set([FOREBAY_HOST_ID, RUNTIME_ID, KOFFI_ID]);

export interface InstallOptions {
  catalog: CatalogSource[];
  places: HostPlaces;
  /** The home of the host whose settings name the enabled set. */
  home: string;
  /** The plugins installed and enabled when the ecosystem settings name none. */
  defaults: string[];
  /** Plugins asked for by name: installed and enabled whatever the settings already say. */
  requested?: string[];
  fetcher?: Fetcher;
  /** The catalog and libraries a caller already bootstrapped from `catalog`, so its index is read once. */
  bootstrap?: Bootstrap;
}

interface InstallRun {
  options: InstallOptions;
  catalog: Catalog;
  fetcher: Fetcher;
  report: InstallReport;
  loaded: HostLibraries;
  runtime: Runtime;
}

/** @implNote A pin on the host or a library sits under `plugins` too, and does not make the settings name a plugin. */
function mentionedPlugins(settings: Record<string, unknown>): string[] {
  return isRecord(settings.plugins) ? Object.keys(settings.plugins).filter((id) => !FOUNDATION_IDS.has(id)) : [];
}

function pluginTargets(settings: Record<string, unknown>, defaults: string[], requested: string[]): InstallTarget[] {
  const chosen: InstallTarget[] = mentionedPlugins(settings).length === 0 ? defaults.map((id) => ({ id })) : enabledPlugins(settings);
  const named = new Set(chosen.map(({ id }) => id));
  const asked = requested.filter((id) => !named.has(id) && named.add(id));
  return [...chosen, ...pinnedTargets(asked, pinnedVersions(settings))];
}

function isEnabled(settings: Record<string, unknown>, id: string): boolean {
  const plugins = settings.plugins;
  return isRecord(plugins) && isRecord(plugins[id]) && plugins[id].enabled === true;
}

/** @implNote Only an id the settings never mention is enabled unasked, so a plugin the user turned off stays off. */
function enableChoices(settings: HostSettings, installed: string[], requested: string[]): string[] {
  const current = settings.all();
  const mentioned = new Set(mentionedPlugins(current));
  const enabling = installed.filter((id) => (requested.includes(id) || !mentioned.has(id)) && !isEnabled(current, id));
  for (const id of enabling) settings.set(`plugins.${id}.enabled`, true, PORTABLE);
  return enabling;
}

/** The next start loads what this resolves to; the references keep both that and what is loaded now from any sweep. */
function recordResolution(run: InstallRun, settings: Record<string, unknown>, installed: Record<string, string>): void {
  const { places } = run.options;
  const references = hostLibraryReferences({ cache: places.cache, state: places.state, hostId: FOREBAY_HOST_ID, catalog: run.catalog, settings, loaded: run.loaded, running: installed });
  recordReferences(places.state, FOREBAY_HOST_ID, references);
}

/**
 * @implNote The standalone host writes nothing onto the PATH, so its registration reads no
 * environment; the first registration wins, so a reinstall keeps the first install's time.
 */
function registerInstalledHost(run: InstallRun, version: string | undefined): void {
  if (version === undefined) return;
  const { places } = run.options;
  registerHost(run.runtime, places, forebayHostIdentity(places, version), forebayHostProvenance(places.cache, version, new Date()), {});
}

async function installWithSettings(run: InstallRun, settings: HostSettings): Promise<void> {
  const { options, catalog, fetcher, report } = run;
  const current = settings.all();
  const pins = pinnedVersions(current);
  const cache = options.places.cache;
  const host = await installItems(catalog, pinnedTargets([FOREBAY_HOST_ID], pins), "host", cache, fetcher, report);
  await installItems(catalog, pinnedTargets([RUNTIME_ID, KOFFI_ID], pins), "library", cache, fetcher, report);
  const requested = options.requested ?? [];
  const plugins = await installItems(catalog, pluginTargets(current, options.defaults, requested), "plugin", cache, fetcher, report);
  report.enabled = enableChoices(settings, Object.keys(plugins), requested);
  recordCatalogSources(run.runtime, options.places, options.home, options.catalog);
  registerInstalledHost(run, host[FOREBAY_HOST_ID]);
  recordResolution(run, current, { ...host, ...plugins });
}

/**
 * Installs the ecosystem from a catalog: the host's own bundle, the runtime, koffi, and the plugins
 * the ecosystem settings enable, or `defaults` when they name none, plus any `requested` by name,
 * each at its pin or the catalog's `latest`.
 *
 * @remarks Every installed default and every requested plugin is enabled in the portable settings,
 * each catalog source not yet listed is appended to `catalog.sources`, and the installed host is
 * registered. The runtime and koffi the next start
 * loads are resolved by the rule bundles follow and recorded. An item that cannot be installed is
 * reported and the rest still install; without a runtime no settings can be read, so nothing past
 * the runtime and koffi is installed.
 */
export async function installEcosystem(options: InstallOptions): Promise<InstallReport> {
  const fetcher = options.fetcher ?? defaultFetcher();
  const bootstrap = options.bootstrap ?? (await bootstrapLibraries(options.catalog, options.places.cache, fetcher));
  if (bootstrap.libraries === undefined) return bootstrap.report;
  const runtime = openRuntime(verifiedRuntimeSource(options.places.cache, bootstrap.libraries, currentPlatformKey()));
  const run: InstallRun = { options, catalog: bootstrap.catalog, fetcher, report: emptyReport(), loaded: bootstrap.libraries, runtime };
  try {
    await installWithSettings(run, hostSettings(runtime, options.places, options.home));
  } finally {
    runtime.close();
  }
  return mergeReports(bootstrap.report, run.report);
}

export type { InstallReport };
