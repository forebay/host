import type { HostPlaces } from "../context/places.js";
import { hostSettings } from "../host-settings.js";
import type { HostIdentity } from "../identity.js";
import { cacheBundles } from "../plugins/cache-bundles.js";
import type { CacheBundles } from "../plugins/cache-bundles.js";
import { openRuntime } from "../runtime/open.js";
import type { Runtime } from "../runtime/open.js";
import type { UpdatesService } from "../runtime/types.js";
import { startHost } from "../start.js";
import type { RunningHost } from "../start.js";
import { navigationOf, renderScreen } from "../ui/screen.js";
import type { HeadlessScreen, Navigation, ScreenRequest } from "../ui/screen.js";
import { userHomeOf } from "../user-home.js";
import { cachedLayerOf, LAYER_ID } from "./cached-layer.js";
import type { CachedLayer } from "./cached-layer.js";
import { startProcessTimer } from "./process-timer.js";
import type { ProcessTimer } from "./process-timer.js";
import { registeredIdentity } from "./registered-identity.js";
import { startUpdateTimer } from "./update-timer.js";
import type { UpdateTimer } from "./update-timer.js";

type Applied = ReturnType<UpdatesService["apply"]>;

export interface JavascriptHostOptions {
  hostId: string;
  /** The file of the installed javascript-host bundle this process runs, `<cache>/bundles/javascript-host/<version>/host.js`. */
  bundleFile: string;
  environment: Record<string, string>;
  /** Whether holders keep this host alive, as for a background host a launcher holds. */
  held: boolean;
  /** Called once when no holder is left, after the host has stopped. */
  onUnheld?(): void;
  writeError(text: string): void;
}

/** One registered host's plugins running on the javascript-host. */
export interface JavascriptHost {
  running: RunningHost;
  navigation(): Navigation;
  render(screen: ScreenRequest): Promise<HeadlessScreen>;
  updates: Pick<UpdateTimer, "lastCheck">;
  stop(): Promise<void>;
}

interface Started {
  layer: CachedLayer;
  runtime: Runtime;
  places: HostPlaces;
  identity: HostIdentity;
  settings: Record<string, unknown>;
  applied: Applied;
  bundles: CacheBundles;
}

function applied(runtime: Runtime, places: HostPlaces, layer: CachedLayer, identity: HostIdentity, settings: Record<string, unknown>): Applied {
  const running = { [identity.id]: identity.version, [LAYER_ID]: layer.version, runtime: layer.libraries.runtime, koffi: layer.libraries.koffi };
  return runtime.updates.apply({ places: { state: places.state, cache: places.cache }, hostId: identity.id, settings, running });
}

function reportUnrecorded(hostId: string, unrecorded: Applied["unrecorded"], writeError: (text: string) => void): void {
  for (const { message, fix } of unrecorded) writeError(`spisor could not record part of the start of ${hostId}: ${message}\nfix: ${fix}\n`);
}

/** Resolves the registration and what `updates.apply` runs, closing the runtime again when either is refused. */
function prepared(options: JavascriptHostOptions): Started {
  const layer = cachedLayerOf(options.bundleFile);
  const runtime = openRuntime(layer.source);
  try {
    const places = runtime.places.resolve({ home: userHomeOf(options.environment), environment: options.environment });
    const identity = registeredIdentity(runtime, places, options.hostId);
    const settings = hostSettings(runtime, places, identity.home).all();
    const answer = applied(runtime, places, layer, identity, settings);
    reportUnrecorded(identity.id, answer.unrecorded, options.writeError);
    return { layer, runtime, places, identity, settings, applied: answer, bundles: cacheBundles(runtime, places.cache, answer.plugins) };
  } catch (error) {
    runtime.close();
    throw error;
  }
}

function timersOf(started: Started, options: JavascriptHostOptions, onUnheld: () => void): { process: ProcessTimer; updates: UpdateTimer } {
  const { runtime, places, identity, applied: answer } = started;
  const process = startProcessTimer({
    runtime,
    state: places.state,
    hostId: identity.id,
    run: answer.run,
    record: answer.runRecord,
    held: options.held,
    onUnheld,
    onFailure: (message) => options.writeError(`spisor could not check the holders of ${identity.id}: ${message}\n`),
  });
  const updates = startUpdateTimer({ source: started.layer.source, places, hostId: identity.id, settings: started.settings, problems: () => started.bundles.problems() });
  return { process, updates };
}

function stopper(started: Started, running: RunningHost, timers: { process: ProcessTimer; updates: UpdateTimer }): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  const stopOnce = async () => {
    timers.process.stop();
    try {
      await Promise.all([timers.updates.stop(), running.stop()]);
    } finally {
      started.runtime.processes.removeRuns({ state: started.places.state, hostId: started.identity.id, record: started.applied.runRecord });
      started.runtime.close();
    }
  };
  return () => (stopping ??= stopOnce());
}

/**
 * Starts the plugins `updates.apply` answers for registered host `hostId`, from the cache the
 * javascript-host bundle is installed in, with its run record stamped and its catalog checked on
 * their timers, and for a held host its holders pruned until none is left.
 *
 * @implNote The holder timer runs from before the plugins start, so a slow start still stamps the
 * host alive; unheld mid-start, the host stops as soon as its start answers.
 */
export async function startJavascriptHost(options: JavascriptHostOptions): Promise<JavascriptHost> {
  const started = prepared(options);
  let host: JavascriptHost | undefined;
  let unheld = false;
  const onUnheld = () => {
    unheld = true;
    if (host !== undefined) void host.stop().finally(() => options.onUnheld?.());
  };
  const timers = timersOf(started, options, onUnheld);
  let running: RunningHost;
  try {
    running = await startHost({ identity: { ...started.identity, version: started.applied.run[started.identity.id] ?? started.identity.version }, runtime: started.layer.source, bundles: started.bundles, environment: options.environment });
  } catch (error) {
    timers.process.stop();
    await timers.updates.stop();
    started.runtime.processes.removeRuns({ state: started.places.state, hostId: started.identity.id, record: started.applied.runRecord });
    started.runtime.close();
    throw error;
  }
  host = { running, navigation: () => navigationOf(running), render: (screen) => renderScreen(running, screen), updates: timers.updates, stop: stopper(started, running, timers) };
  if (unheld) onUnheld();
  return host;
}
