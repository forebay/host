import { activityPublisher } from "../context/activity.js";
import { scopedLogger } from "../context/log.js";
import type { HostPlaces } from "../context/places.js";
import { forebayLibraryServices, openForebayLibrary } from "../forebay-library/open.js";
import type { ForebayLibrary } from "../forebay-library/open.js";
import { hostSettings } from "../host-settings.js";
import type { HostIdentity } from "../identity.js";
import { cacheBundles } from "../plugins/cache-bundles.js";
import type { CacheBundles } from "../plugins/cache-bundles.js";
import { openRuntime } from "../runtime/open.js";
import type { Runtime } from "../runtime/open.js";
import type { UpdatesService } from "../runtime/types.js";
import { startHost } from "../start.js";
import type { RunningHost } from "../start.js";
import { readyPublisher } from "../proxy/publish.js";
import { serveProxy } from "../proxy/serve.js";
import type { ProxyServer } from "../proxy/serve.js";
import { navigationOf, renderScreen } from "../ui/screen.js";
import type { HeadlessScreen, Navigation, ScreenRequest } from "../ui/screen.js";
import { userHomeOf } from "../user-home.js";
import { cachedLayerOf, hintedForebayLibrary, LAYER_ID } from "./cached-layer.js";
import type { CachedLayer } from "./cached-layer.js";
import { startProcessTimer } from "./process-timer.js";
import { startRefusalOf } from "./start-refusal.js";
import type { ProcessTimer } from "./process-timer.js";
import { registeredIdentity } from "./registered-identity.js";
import { checkInWorker } from "./update-check.js";
import { startUpdateTimer } from "./update-timer.js";
import type { UpdateTimer } from "./update-timer.js";

type Applied = ReturnType<UpdatesService["apply"]>;
/** What a start runs: its plugins, the whole run it records, the run record it stamps, and what it could not record. */
type StartPlan = Pick<Applied, "plugins" | "run" | "runRecord" | "unrecorded">;

export interface JavascriptHostOptions {
  hostId: string;
  /** The file of the installed javascript-host bundle this process runs, `<cache>/bundles/javascript-host/<version>/host.js`. */
  bundleFile: string;
  environment: Record<string, string>;
  /** Whether holders keep this host alive, as for a background host a launcher holds. */
  held: boolean;
  /**
   * Whether this start is the application's session host, which serves an enabled front door and
   * publishes its ready record; a start that runs one action is not.
   */
  session: boolean;
  /** Called once when no holder is left, after the host has stopped: with 0, or 1 when the stop failed. */
  onUnheld?(exitCode: number): void;
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
  library: ForebayLibrary;
  userHome: string;
  places: HostPlaces;
  identity: HostIdentity;
  settings: Record<string, unknown>;
  applied: StartPlan;
  bundles: CacheBundles;
}

/** What this process runs beside the host's plugins: the host, the javascript-host bundle and the libraries it loaded. */
function runningOf(layer: CachedLayer, identity: HostIdentity, libraryVersion: string): Record<string, string> {
  return { [identity.id]: identity.version, [LAYER_ID]: layer.version, runtime: layer.libraries.runtime, koffi: layer.libraries.koffi, apps: libraryVersion };
}

function runsLive(runtime: Runtime, places: HostPlaces, identity: HostIdentity): boolean {
  return runtime.processes.liveRuns({ state: places.state }).runs.some((run) => identity.id in run);
}

/**
 * What the host's last start recorded running, with a run record of its own, or undefined when no
 * start recorded anything or nothing of the host runs now.
 *
 * @implNote `updates.apply` may switch the host and its plugins to a scheduled version and rewrite
 * their references, which a second process beside a running session host must not do; a host with no
 * live run has no running session to switch under, so it is applied, which is also what starts a
 * plugin enabled since the last start.
 */
function recordedPlan(runtime: Runtime, places: HostPlaces, identity: HostIdentity, running: Record<string, string>): StartPlan | undefined {
  const { run } = runtime.updates.recorded({ places: { state: places.state, cache: places.cache }, hostId: identity.id });
  if (Object.keys(run).length === 0 || !runsLive(runtime, places, identity)) return undefined;
  const plugins = Object.fromEntries(Object.entries(run).filter(([id]) => !(id in running)));
  const { record } = runtime.processes.recordRun({ state: places.state, hostId: identity.id, run });
  return { plugins, run, runRecord: record, unrecorded: [] };
}

function planned(runtime: Runtime, places: HostPlaces, identity: HostIdentity, settings: Record<string, unknown>, running: Record<string, string>, session: boolean): StartPlan {
  const recorded = session ? undefined : recordedPlan(runtime, places, identity, running);
  return recorded ?? runtime.updates.apply({ places: { state: places.state, cache: places.cache }, hostId: identity.id, settings, running });
}

/** @implNote Best effort: the start is refused either way, and a publish that fails must not hide why. */
function publishRefusal(runtime: Runtime, state: string, options: JavascriptHostOptions, error: unknown): void {
  if (!options.session) return;
  const { detail, fix } = startRefusalOf(error);
  try {
    readyPublisher(runtime, state, options.hostId).refusal(detail, fix);
  } catch {
    return;
  }
}

function reportUnrecorded(hostId: string, unrecorded: Applied["unrecorded"], writeError: (text: string) => void): void {
  for (const { message, fix } of unrecorded) writeError(`spisor could not record part of the start of ${hostId}: ${message}\nfix: ${fix}\n`);
}

/** Opens the `apps` library the boot hint names, its `apps` functions answering from the host's environment and the user's home. */
function openedLibrary(runtime: Runtime, layer: CachedLayer, options: JavascriptHostOptions, userHome: string): { library: ForebayLibrary; version: string } {
  const { version, source } = hintedForebayLibrary(runtime, layer);
  return { version, library: openForebayLibrary(source, () => ({ environment: options.environment, home: userHome, arguments: [] })) };
}

/**
 * Resolves the registration and what this start runs, closing the libraries again when either is
 * refused, and for a session start publishing the refusal once the places are known.
 *
 * @implNote A start that fails before the runtime is open or its places resolve (the bundle outside a
 * cache, a hint naming no runtime or koffi, a runtime that will not load, an environment with no home)
 * has nowhere to publish, and reports on stderr only.
 */
function prepared(options: JavascriptHostOptions): Started {
  const layer = cachedLayerOf(options.bundleFile);
  const runtime = openRuntime(layer.source);
  let places: HostPlaces | undefined;
  let library: ForebayLibrary | undefined;
  try {
    const userHome = userHomeOf(options.environment);
    places = runtime.places.resolve({ home: userHome, environment: options.environment });
    const opened = openedLibrary(runtime, layer, options, userHome);
    library = opened.library;
    const identity = registeredIdentity(runtime, places, options.hostId);
    const settings = hostSettings(runtime, places, identity.home).all();
    const plan = planned(runtime, places, identity, settings, runningOf(layer, identity, opened.version), options.session);
    reportUnrecorded(identity.id, plan.unrecorded, options.writeError);
    return { layer, runtime, library, userHome, places, identity, settings, applied: plan, bundles: cacheBundles(runtime, places.cache, plan.plugins) };
  } catch (error) {
    if (places !== undefined) publishRefusal(runtime, places.state, options, error);
    library?.close();
    runtime.close();
    throw error;
  }
}

interface Timers {
  process: ProcessTimer;
  updates: UpdateTimer;
  checks: AbortController;
}

/** No timer at all, for a one-shot start beside a session that may be live: it must not check, switch or prune anything of that session's. */
function noTimers(): Timers {
  return { process: { stop: () => undefined }, updates: { lastCheck: () => null, stop: async () => undefined }, checks: new AbortController() };
}

function timersOf(started: Started, options: JavascriptHostOptions, onUnheld: () => void): Timers {
  if (!options.session) return noTimers();
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
  const checks = new AbortController();
  const check = { source: started.layer.source, places, hostId: identity.id, settings: started.settings, problems: () => started.bundles.problems() };
  const updates = startUpdateTimer({ hostId: identity.id, check: () => checkInWorker(check, checks.signal), writeError: options.writeError });
  return { process, updates, checks };
}

async function stopTimers(timers: Timers): Promise<void> {
  timers.process.stop();
  timers.checks.abort();
  await timers.updates.stop();
}

/** Removes this start's run record and closes both libraries, closing them even when the removal throws. */
function release(started: Started): void {
  try {
    started.runtime.processes.removeRuns({ state: started.places.state, hostId: started.identity.id, record: started.applied.runRecord });
  } finally {
    started.library.close();
    started.runtime.close();
  }
}

/** @implNote The proxy stops first, so no request reaches a plugin that is already deactivating. */
function stopper(started: Started, running: RunningHost, timers: Timers, proxy: ProxyServer): () => Promise<void> {
  let stopping: Promise<void> | null = null;
  const stopOnce = async () => {
    try {
      await proxy.stop();
      await Promise.all([stopTimers(timers), running.stop()]);
    } finally {
      release(started);
    }
  };
  return () => (stopping ??= stopOnce());
}

function proxyOf(started: Started, running: RunningHost, options: JavascriptHostOptions): Promise<ProxyServer> {
  if (!options.session) return Promise.resolve({ stop: async () => undefined });
  const { runtime, places, identity } = started;
  const scope = () => ({ home: identity.home, portable: places.portable, plugin: "proxy", config: {} });
  return serveProxy({
    hostId: identity.id,
    loaded: running.loaded,
    settings: started.settings,
    library: started.library,
    publisher: readyPublisher(runtime, places.state, identity.id),
    environment: options.environment,
    userHome: started.userHome,
    log: scopedLogger(runtime, scope, new Date().toISOString(), activityPublisher(running.events, "proxy")),
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    host?.stop().then(
      () => options.onUnheld?.(0),
      (error: unknown) => {
        options.writeError(`spisor could not stop ${options.hostId}: ${messageOf(error)}
`);
        options.onUnheld?.(1);
      },
    );
  };
  const timers = timersOf(started, options, onUnheld);
  let running: RunningHost;
  try {
    running = await startHost({
      identity: { ...started.identity, version: started.applied.run[started.identity.id] ?? started.identity.version },
      runtime: started.layer.source,
      bundles: started.bundles,
      environment: options.environment,
      services: forebayLibraryServices(started.library),
    });
  } catch (error) {
    publishRefusal(started.runtime, started.places.state, options, error);
    try {
      await stopTimers(timers);
    } finally {
      release(started);
    }
    throw error;
  }
  const proxy = await proxyOf(started, running, options);
  host = { running, navigation: () => navigationOf(running), render: (screen) => renderScreen(running, screen), updates: timers.updates, stop: stopper(started, running, timers, proxy) };
  if (unheld) onUnheld();
  return host;
}
