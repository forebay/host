import { defaultFetcher } from "../cache/fetcher.js";
import type { Fetcher } from "../cache/fetcher.js";
import type { CatalogSource } from "../catalog/sources.js";
import type { HostPlaces } from "../context/places.js";
import { hostSettings } from "../host-settings.js";
import type { HostSettings } from "../host-settings.js";
import { enabledPlugins } from "../plugins/enabled.js";
import { isRecord } from "../plugins/is-record.js";
import { cachedRuntime } from "../runtime/cached-runtime.js";
import { openRuntime } from "../runtime/open.js";
import { recordReferences } from "../updates/references.js";
import { FOREBAY_HOST_ID } from "./forebay-host.js";
import { installFoundation, RUNTIME_ID } from "./install-foundation.js";
import type { Foundation } from "./install-foundation.js";
import { installItems } from "./install-items.js";
import type { InstallTarget } from "./install-items.js";
import type { InstallReport } from "./install-report.js";

const PORTABLE = "portable";

export interface InstallOptions {
  catalog: CatalogSource[];
  places: HostPlaces;
  /** The home of the host whose settings name the enabled set. */
  home: string;
  /** The plugins installed and enabled when the ecosystem settings name none. */
  defaults: string[];
  fetcher?: Fetcher;
}

function mentionedPlugins(settings: Record<string, unknown>): string[] {
  return isRecord(settings.plugins) ? Object.keys(settings.plugins) : [];
}

function pluginTargets(settings: Record<string, unknown>, defaults: string[]): InstallTarget[] {
  if (mentionedPlugins(settings).length === 0) return [...new Set(defaults)].map((id) => ({ id }));
  return enabledPlugins(settings);
}

function hasCatalogSources(settings: Record<string, unknown>): boolean {
  return isRecord(settings.catalog) && settings.catalog.sources !== undefined;
}

/** @implNote Only an id the settings never mention is enabled, so a plugin the user turned off stays off. */
function recordChoices(settings: HostSettings, installed: string[], sources: CatalogSource[]): void {
  const current = settings.all();
  const mentioned = new Set(mentionedPlugins(current));
  for (const id of installed.filter((candidate) => !mentioned.has(candidate))) settings.set(`plugins.${id}.enabled`, true, PORTABLE);
  if (!hasCatalogSources(current)) settings.set("catalog.sources", sources, PORTABLE);
}

async function installPlugins(foundation: Foundation, options: InstallOptions, fetcher: Fetcher): Promise<void> {
  const runtime = openRuntime(cachedRuntime(options.places.cache, foundation.versions[RUNTIME_ID] as string));
  try {
    const settings = hostSettings(runtime, options.places, options.home);
    const targets = pluginTargets(settings.all(), options.defaults);
    const plugins = await installItems(foundation.catalog, targets, "plugin", options.places.cache, fetcher, foundation.report);
    recordChoices(settings, Object.keys(plugins), options.catalog);
    recordReferences(options.places.state, FOREBAY_HOST_ID, { run: { ...foundation.versions, ...plugins }, next: {} });
  } finally {
    runtime.close();
  }
}

/**
 * Installs the ecosystem from a catalog: the host's own bundle, the runtime, koffi, and the plugins
 * the ecosystem settings enable, or `defaults` when they name none, each at the catalog's `latest`
 * unless pinned.
 *
 * @remarks Every installed default is enabled in the portable settings, and the catalog's sources
 * are recorded there when none are. An item that cannot be installed is reported and the rest still
 * install; without the runtime no settings can be read, so no plugin is installed.
 */
export async function installEcosystem(options: InstallOptions): Promise<InstallReport> {
  const fetcher = options.fetcher ?? defaultFetcher();
  const foundation = await installFoundation(options.catalog, options.places.cache, fetcher);
  if (foundation.versions[RUNTIME_ID] !== undefined) await installPlugins(foundation, options, fetcher);
  return foundation.report;
}

export type { InstallReport };
