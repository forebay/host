import { join } from "node:path";
import { startPlugins } from "@weivel/typescript/host";
import type { LoadedHost, PluginHostOptions } from "@weivel/typescript/host";
import type { PluginManifest } from "@weivel/typescript";
import type { RuntimeEvents } from "@weivel/typescript/engine";
import { buildRuntime } from "./context/build.js";
import type { HostPlaces } from "./context/places.js";
import { reconcileSecretsInBackground } from "./context/reconcile.js";
import type { ReconcileAnswer } from "./context/reconcile-worker.js";
import { eventBus } from "./event-bus.js";
import { hostSettings } from "./host-settings.js";
import type { HostSettings } from "./host-settings.js";
import { hostsApi } from "./hosts.js";
import type { HostsApi } from "./hosts.js";
import type { HostIdentity } from "./identity.js";
import type { BundleSource } from "./plugins/bundle-source.js";
import { scanOf } from "./plugins/scan.js";
import { selectPlugins } from "./plugins/selection.js";
import type { PluginSelection } from "./plugins/selection.js";
import { registerHost } from "./registration.js";
import type { Provenance, RegisteredHost } from "./registration.js";
import { openRuntime } from "./runtime/open.js";
import type { Runtime, RuntimeSource } from "./runtime/open.js";
import { trackReconcile } from "./reconcile-tracker.js";
import type { ReconcileTracker } from "./reconcile-tracker.js";
import { statusOf } from "./status.js";
import type { CatalogStatus, HostStatus } from "./status.js";
import { catalogStart } from "./updates/catalog-start.js";
import type { CatalogStart, HostCatalog } from "./updates/catalog-start.js";
import type { UpdateTracker } from "./updates/background.js";
import { userHomeOf } from "./user-home.js";

export interface HostOptions {
  identity: HostIdentity;
  runtime: RuntimeSource;
  /** A fixed set of bundles; give exactly one of this and `catalog`. */
  bundles?: BundleSource;
  /** Run from the cache, the catalog's sources checked in the background; give exactly one of this and `bundles`. */
  catalog?: HostCatalog;
  provenance: Provenance;
  consumes?: string[];
  defaults?: Record<string, string>;
  environment?: Record<string, string>;
  surfaces?: string[];
}

export interface RunningHost {
  loaded: LoadedHost;
  places: HostPlaces;
  bundles: BundleSource;
  hosts: HostsApi;
  /** The bus every plugin of this host publishes to, activity on `ACTIVITY_TOPIC` included. */
  events: RuntimeEvents;
  settings: HostSettings;
  /** How this start registered the host, the commands it was given and any it was refused. */
  registration: RegisteredHost;
  status(): HostStatus;
  stop(): Promise<void>;
}

/**
 * What `startHost` reaches the engine and the secrets worker through.
 *
 * @internal Replaced in tests through {@link startHostWith}; not part of the package entry.
 */
export interface HostEngine {
  startPlugins(options: PluginHostOptions): Promise<LoadedHost>;
  reconcileSecrets(source: RuntimeSource, places: HostPlaces, signal: AbortSignal): Promise<ReconcileAnswer>;
}

const ENGINE: HostEngine = {
  startPlugins,
  reconcileSecrets: reconcileSecretsInBackground,
};

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/**
 * @implNote A service the host names, as one it consumes or one it has a default for, is a shared
 * contract, so any plugin may provide it under that bare id rather than its own namespace.
 */
function wellKnownServicesOf(consumes: readonly string[], defaults: Record<string, string>): string[] {
  return [...new Set([...consumes, ...Object.keys(defaults)])];
}

interface StartBundles {
  bundles: BundleSource;
  catalog: CatalogStart | null;
}

function assertOneBundleOrigin(options: HostOptions): void {
  const given = [options.bundles, options.catalog].filter((origin) => origin !== undefined).length;
  if (given === 1) return;
  throw new Error(
    `startHost takes exactly one of bundles and catalog, but was given ${given === 0 ? "neither" : "both"}; pass bundles for a fixed set, or catalog to run from the cache`,
  );
}

function startBundles(settings: Record<string, unknown>, places: HostPlaces, options: HostOptions): StartBundles {
  if (options.catalog === undefined) return { bundles: options.bundles as BundleSource, catalog: null };
  const catalog = catalogStart(options.catalog, places, options.identity.id, settings, options.defaults ?? {});
  return { bundles: catalog.bundles, catalog };
}

/** @implNote `pluginDir` is required by the engine but never read, because the `scan` built from the bundle source replaces it. */
function pluginHostOptions(runtime: Runtime, places: HostPlaces, options: HostOptions, selection: PluginSelection, bus: RuntimeEvents): PluginHostOptions {
  const wellKnownServices = wellKnownServicesOf(options.consumes ?? [], options.defaults ?? {});
  const startedAt = new Date().toISOString();
  return {
    app: options.identity.id,
    pluginDir: join(places.cache, "bundles"),
    surfaces: options.surfaces,
    wellKnownServices: wellKnownServices.map((id) => ({ id })),
    scan: scanOf(selection.bundles, wellKnownServices),
    runtimeFor: (manifest: PluginManifest) => buildRuntime(runtime, places, options.identity, manifest, bus, startedAt),
    libraryCache: join(places.cache, "libraries"),
  };
}

/** Stops the plugins, then the background workers, before the runtime they call into closes, once however often it is called. */
function stopper(loaded: LoadedHost, reconcile: ReconcileTracker, updates: UpdateTracker | null, runtime: Runtime): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  const stopOnce = async () => {
    try {
      await loaded.stop();
    } finally {
      try {
        await Promise.all([reconcile.stop(), updates?.stop()]);
      } finally {
        runtime.close();
      }
    }
  };
  return () => (stopping ??= stopOnce());
}

async function loadPlugins(
  runtime: Runtime,
  places: HostPlaces,
  options: HostOptions,
  engine: HostEngine,
  environment: Record<string, string>,
  bus: RuntimeEvents,
) {
  const registration = registerHost(runtime, places, options.identity, options.provenance, environment);
  const settings = hostSettings(runtime, places, options.identity).all();
  const origin = startBundles(settings, places, options);
  const selection = selectPlugins(settings, origin.bundles, options.consumes ?? [], options.defaults ?? {});
  const loaded = await engine.startPlugins(pluginHostOptions(runtime, places, options, selection, bus));
  return { registration, selection, loaded, origin };
}

function catalogStatus(catalog: CatalogStart | null, updates: UpdateTracker | null): CatalogStatus | undefined {
  if (catalog === null || updates === null) return undefined;
  return { bundleProblems: catalog.bundles.problems(), updates: updates.progress() };
}

/** @implNote A start that throws stops the reconcile worker too, since no `stop` exists yet to reach it. */
async function startOn(runtime: Runtime, options: HostOptions, engine: HostEngine): Promise<RunningHost> {
  const environment = options.environment ?? processEnvironment();
  const places = runtime.places.resolve({ home: userHomeOf(environment), environment });
  const reconcile = trackReconcile((signal) => engine.reconcileSecrets(options.runtime, places, signal));
  const bus = eventBus();
  try {
    const { registration, selection, loaded, origin } = await loadPlugins(runtime, places, options, engine, environment, bus);
    const updates = origin.catalog?.startUpdates() ?? null;
    return {
      loaded,
      places,
      bundles: origin.bundles,
      hosts: hostsApi(runtime, places, environment),
      events: bus,
      settings: hostSettings(runtime, places, options.identity),
      registration,
      status: () => statusOf(options.identity.id, loaded, selection.missing, reconcile.outcome(), catalogStatus(origin.catalog, updates)),
      stop: stopper(loaded, reconcile, updates, runtime),
    };
  } catch (error) {
    await reconcile.stop();
    throw error;
  }
}

/**
 * Starts a host with parts of its engine replaced.
 *
 * @internal A test seam, kept out of the package entry; an application calls {@link startHost}.
 * @implNote The runtime is closed again when anything before the plugins start throws, since no
 * `stop` exists yet to close it.
 */
export async function startHostWith(options: HostOptions, engine: Partial<HostEngine>): Promise<RunningHost> {
  assertOneBundleOrigin(options);
  const runtime = openRuntime(options.runtime);
  try {
    return await startOn(runtime, options, { ...ENGINE, ...engine });
  } catch (error) {
    runtime.close();
    throw error;
  }
}

/**
 * Opens the runtime, registers the host and starts the plugins its settings enable, in the order
 * their declared services give.
 */
export function startHost(options: HostOptions): Promise<RunningHost> {
  return startHostWith(options, {});
}
