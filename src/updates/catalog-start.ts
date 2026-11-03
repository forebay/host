import { cacheBundleSource } from "../cache/cache-bundle-source.js";
import type { CacheBundleSource } from "../cache/cache-bundle-source.js";
import { defaultFetcher } from "../cache/fetcher.js";
import type { Fetcher } from "../cache/fetcher.js";
import type { CatalogSource } from "../catalog/sources.js";
import type { HostPlaces } from "../context/places.js";
import { disabledPlugins, enabledPlugins, pinnedVersions } from "../plugins/enabled.js";
import type { EnabledPlugin } from "../plugins/enabled.js";
import { isRecord } from "../plugins/is-record.js";
import { startUpdates } from "./background.js";
import type { UpdateTracker } from "./background.js";
import type { CatalogTransport } from "./check.js";
import { currentCatalogs } from "./current-catalogs.js";
import { installedVersions } from "./installed.js";
import { recordReferences } from "./references.js";
import type { HostReferences } from "./references.js";
import { defaultCatalogTransport } from "./transport.js";
import { resolveVersions } from "./versions.js";

const DEFAULT_INTERVAL_HOURS = 24;

/** Where a host started from a catalog finds its bundles, and how it reaches the catalog's sources. */
export interface HostCatalog {
  sources: CatalogSource[];
  transport?: CatalogTransport;
  fetcher?: Fetcher;
  /** Versions the host uses from the cache beside its plugins (its own bundle, its libraries), recorded so no sweep removes them. */
  references?: HostReferences;
  /**
   * Whether the start checks the catalog and fetches in the background; true when absent.
   *
   * @internal A one-shot command such as `status` reports and stops, so it never starts a check it would abandon.
   */
  checkUpdates?: boolean;
}

export interface CatalogStart {
  bundles: CacheBundleSource;
  /** Starts the background update; called once the plugins have started, never awaited by the start. */
  startUpdates(): UpdateTracker;
}

/** `updates.intervalHours` from the ecosystem settings, 24 when it is absent or not a positive number. */
function intervalHoursOf(settings: Record<string, unknown>): number {
  const configured = isRecord(settings.updates) ? settings.updates.intervalHours : undefined;
  return typeof configured === "number" && Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_INTERVAL_HOURS;
}

/** @implNote A host default may start too, so its id is resolved with the enabled set, held to its own pin. */
function candidatesOf(settings: Record<string, unknown>, defaults: Record<string, string>): EnabledPlugin[] {
  const enabled = enabledPlugins(settings);
  const known = new Set([...enabled.map(({ id }) => id), ...disabledPlugins(settings)]);
  const pins = pinnedVersions(settings);
  const added = [...new Set(Object.values(defaults))].filter((id) => !known.has(id)).sort();
  return [...enabled, ...added.map((id) => (Object.hasOwn(pins, id) ? { id, pin: pins[id] as string } : { id }))];
}

/**
 * Resolves this start's bundles from the cache with no request, and records them as this host's references.
 *
 * @remarks Only installed versions run; what the catalog offers beyond them is fetched by the
 * background update and switches on the next start (spec 7.2).
 */
export function catalogStart(catalog: HostCatalog, places: HostPlaces, hostId: string, settings: Record<string, unknown>, defaults: Record<string, string>): CatalogStart {
  const enabled = candidatesOf(settings, defaults);
  const { run, fetch } = resolveVersions(currentCatalogs(catalog.sources, places.cache), enabled, installedVersions(places.cache));
  const recorded = { ...catalog.references?.run, ...run };
  const kept = catalog.references?.next ?? {};
  recordReferences(places.state, hostId, { run: recorded, next: { ...kept, ...Object.fromEntries(fetch.map(({ id, version }) => [id, version])) } });
  const bundles = cacheBundleSource(places.cache, run);
  return {
    bundles,
    startUpdates: () =>
      startUpdates({
        sources: catalog.sources,
        cache: places.cache,
        state: places.state,
        intervalHours: intervalHoursOf(settings),
        transport: catalog.transport ?? defaultCatalogTransport(),
        fetcher: catalog.fetcher ?? defaultFetcher(),
        enabled,
        hostId,
        run: recorded,
        kept,
        problems: () => bundles.problems(),
      }),
  };
}
