import { join } from "node:path";
import { startPlugins } from "@weivel/typescript/host";
import type { LoadedHost, PluginHostOptions } from "@weivel/typescript/host";
import type { PluginManifest } from "@weivel/typescript";
import type { RuntimeEvents } from "@weivel/typescript/engine";
import { buildRuntime } from "./context/build.js";
import type { HostService } from "./forebay-library/open.js";
import type { HostPlaces } from "./context/places.js";
import { reconcileSecretsInBackground } from "./context/reconcile.js";
import type { ReconcileAnswer } from "./context/reconcile.js";
import { eventBus } from "./event-bus.js";
import { hostSettings } from "./host-settings.js";
import type { HostSettings } from "./host-settings.js";
import type { HostIdentity } from "./identity.js";
import type { BundleSource } from "./plugins/bundle-source.js";
import { scanOf } from "./plugins/scan.js";
import { processEnvironment } from "./process-environment.js";
import { openRuntime } from "./runtime/open.js";
import type { Runtime, RuntimeSource } from "./runtime/open.js";
import { trackReconcile } from "./reconcile-tracker.js";
import type { ReconcileTracker } from "./reconcile-tracker.js";
import { statusOf } from "./status.js";
import type { HostStatus } from "./status.js";
import { userHomeOf } from "./user-home.js";

export interface HostOptions {
  identity: HostIdentity;
  runtime: RuntimeSource;
  /** The bundles to start, every one of them; which plugins run is decided before, by `updates.apply`. */
  bundles: BundleSource;
  consumes?: string[];
  defaults?: Record<string, string>;
  environment?: Record<string, string>;
  surfaces?: string[];
  /** Services the host offers every plugin beside what plugins register, such as `forebay/library`'s. */
  services?: HostService[];
}

export interface RunningHost {
  loaded: LoadedHost;
  places: HostPlaces;
  /** The runtime this host opened; `stop` closes it. */
  runtime: Runtime;
  bundles: BundleSource;
  /** The bus every plugin of this host publishes to, activity on `ACTIVITY_TOPIC` included. */
  events: RuntimeEvents;
  settings: HostSettings;
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

/**
 * @implNote A service the host names, as one it consumes or one it has a default for, is a shared
 * contract, so any plugin may provide it under that bare id rather than its own namespace.
 */
function wellKnownServicesOf(consumes: readonly string[], defaults: Record<string, string>): string[] {
  return [...new Set([...consumes, ...Object.keys(defaults)])];
}

/** @implNote `pluginDir` is required by the engine but never read, because the `scan` built from the bundle source replaces it. */
function pluginHostOptions(runtime: Runtime, places: HostPlaces, options: HostOptions, bus: RuntimeEvents): PluginHostOptions {
  const wellKnownServices = wellKnownServicesOf(options.consumes ?? [], options.defaults ?? {});
  const startedAt = new Date().toISOString();
  return {
    app: options.identity.id,
    pluginDir: join(places.cache, "bundles"),
    surfaces: options.surfaces,
    wellKnownServices: wellKnownServices.map((id) => ({ id })),
    services: options.services,
    scan: scanOf(options.bundles.list(), wellKnownServices),
    runtimeFor: (manifest: PluginManifest) => buildRuntime(runtime, places, options.identity, manifest, bus, startedAt),
    libraryCache: join(places.cache, "libraries"),
  };
}

/** Stops the plugins, then the reconcile worker, before the runtime they call into closes, once however often it is called. */
function stopper(loaded: LoadedHost, reconcile: ReconcileTracker, runtime: Runtime): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  const stopOnce = async () => {
    try {
      await loaded.stop();
    } finally {
      try {
        await reconcile.stop();
      } finally {
        runtime.close();
      }
    }
  };
  return () => (stopping ??= stopOnce());
}

/** @implNote A start that throws stops the reconcile worker too, since no `stop` exists yet to reach it. */
async function startOn(runtime: Runtime, options: HostOptions, engine: HostEngine): Promise<RunningHost> {
  const environment = options.environment ?? processEnvironment();
  const places = runtime.places.resolve({ home: userHomeOf(environment), environment });
  const reconcile = trackReconcile((signal) => engine.reconcileSecrets(options.runtime, places, signal));
  const bus = eventBus();
  try {
    const loaded = await engine.startPlugins(pluginHostOptions(runtime, places, options, bus));
    return {
      loaded,
      places,
      runtime,
      bundles: options.bundles,
      events: bus,
      settings: hostSettings(runtime, places, options.identity.home),
      status: () => statusOf(options.identity.id, loaded, reconcile.outcome()),
      stop: stopper(loaded, reconcile, runtime),
    };
  } catch (error) {
    await reconcile.stop();
    throw error;
  }
}

/**
 * Starts a host with parts of its engine replaced.
 *
 * @internal A test seam kept out of the package entry; an application calls {@link startHost}.
 * @implNote The runtime is closed again when anything before the plugins start throws, since no
 * `stop` exists yet to close it.
 */
export async function startHostWith(options: HostOptions, engine: Partial<HostEngine>): Promise<RunningHost> {
  const runtime = openRuntime(options.runtime);
  try {
    return await startOn(runtime, options, { ...ENGINE, ...engine });
  } catch (error) {
    runtime.close();
    throw error;
  }
}

/** Opens the runtime and starts every plugin the bundle source holds, in the order their declared services give. */
export function startHost(options: HostOptions): Promise<RunningHost> {
  return startHostWith(options, {});
}
