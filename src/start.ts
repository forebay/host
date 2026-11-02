import { join } from "node:path";
import { startPlugins } from "@weivel/typescript/host";
import type { LoadedHost, PluginHostOptions } from "@weivel/typescript/host";
import type { PluginManifest } from "@weivel/typescript";
import { buildRuntime } from "./context/build.js";
import type { HostPlaces } from "./context/places.js";
import { reconcileSecretsInBackground } from "./context/reconcile.js";
import type { ReconcileAnswer } from "./context/reconcile-worker.js";
import { eventBus } from "./event-bus.js";
import { hostsApi } from "./hosts.js";
import type { HostsApi } from "./hosts.js";
import type { HostIdentity } from "./identity.js";
import type { BundleSource } from "./plugins/bundle-source.js";
import { scanOf } from "./plugins/scan.js";
import { selectPlugins } from "./plugins/selection.js";
import type { PluginSelection } from "./plugins/selection.js";
import { registerHost } from "./registration.js";
import type { Provenance } from "./registration.js";
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
  bundles: BundleSource;
  provenance: Provenance;
  consumes?: string[];
  defaults?: Record<string, string>;
  environment?: Record<string, string>;
  surfaces?: string[];
}

export interface RunningHost {
  loaded: LoadedHost;
  places: HostPlaces;
  hosts: HostsApi;
  status(): HostStatus;
  stop(): Promise<void>;
}

/** What `startHost` reaches the engine and the secrets worker through, replaced in tests. */
export interface HostEngine {
  startPlugins(options: PluginHostOptions): Promise<LoadedHost>;
  reconcileSecrets(source: RuntimeSource, places: HostPlaces, signal: AbortSignal): Promise<ReconcileAnswer>;
}

const ENGINE: HostEngine = {
  startPlugins,
  reconcileSecrets: (source, places, signal) => reconcileSecretsInBackground(source, places, undefined, signal),
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

function selectionOf(runtime: Runtime, places: HostPlaces, options: HostOptions): PluginSelection {
  const settings = runtime.settings.all({ home: options.identity.home, portable: places.portable }).values;
  return selectPlugins(settings, options.bundles, options.consumes ?? [], options.defaults ?? {});
}

/** @implNote `pluginDir` is required by the engine but never read, because the `scan` built from the bundle source replaces it. */
function pluginHostOptions(runtime: Runtime, places: HostPlaces, options: HostOptions, selection: PluginSelection): PluginHostOptions {
  const wellKnownServices = wellKnownServicesOf(options.consumes ?? [], options.defaults ?? {});
  const bus = eventBus();
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

/** Stops the plugins, then the reconcile worker, before the runtime they call into closes, once however often it is called. */
function stopper(loaded: LoadedHost, reconcile: ReconcileTracker, runtime: Runtime): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  const stopOnce = async () => {
    try {
      await loaded.stop();
      await reconcile.stop();
    } finally {
      runtime.close();
    }
  };
  return () => (stopping ??= stopOnce());
}

async function loadPlugins(runtime: Runtime, places: HostPlaces, options: HostOptions, engine: HostEngine, environment: Record<string, string>) {
  registerHost(runtime, places, options.identity, options.provenance, environment);
  const selection = selectionOf(runtime, places, options);
  const loaded = await engine.startPlugins(pluginHostOptions(runtime, places, options, selection));
  return { selection, loaded };
}

/** @implNote A start that throws stops the reconcile worker too, since no `stop` exists yet to reach it. */
async function startOn(runtime: Runtime, options: HostOptions, engine: HostEngine): Promise<RunningHost> {
  const environment = options.environment ?? processEnvironment();
  const places = runtime.places.resolve({ home: userHomeOf(environment), environment });
  const reconcile = trackReconcile((signal) => engine.reconcileSecrets(options.runtime, places, signal));
  try {
    const { selection, loaded } = await loadPlugins(runtime, places, options, engine, environment);
    return {
      loaded,
      places,
      hosts: hostsApi(runtime, places, environment),
      status: () => statusOf(options.identity.id, loaded, selection.missing, reconcile.outcome()),
      stop: stopper(loaded, reconcile, runtime),
    };
  } catch (error) {
    await reconcile.stop();
    throw error;
  }
}

/**
 * Opens the runtime, registers the host and starts the plugins its settings enable, in the order
 * their declared services give.
 *
 * @implNote The runtime is closed again when anything before the plugins start throws, since no
 * `stop` exists yet to close it.
 */
export async function startHost(options: HostOptions, engine: Partial<HostEngine> = {}): Promise<RunningHost> {
  const runtime = openRuntime(options.runtime);
  try {
    return await startOn(runtime, options, { ...ENGINE, ...engine });
  } catch (error) {
    runtime.close();
    throw error;
  }
}
