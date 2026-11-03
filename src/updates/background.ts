import type { BundleProblem } from "../cache/cache-bundle-source.js";
import { CacheRefusal } from "../cache/cache-refusal.js";
import type { Fetcher } from "../cache/fetcher.js";
import { installVersion } from "../cache/install-version.js";
import type { Catalog, CatalogItem } from "../catalog/catalog.js";
import type { CatalogSource } from "../catalog/sources.js";
import type { EnabledPlugin } from "../plugins/enabled.js";
import type { StatusRefusal } from "../status.js";
import { checkCatalog } from "./check.js";
import type { CatalogCheck, CatalogTransport } from "./check.js";
import { currentCatalogs } from "./current-catalogs.js";
import { installedVersions } from "./installed.js";
import { recordReferences } from "./references.js";
import { sweepCache } from "./sweep.js";
import { resolveVersions } from "./versions.js";

/** What the background update of one start has done so far. */
export interface UpdateProgress {
  checked: CatalogCheck[];
  /** Each version installed for the next start, as `<id>@<version>`. */
  fetched: string[];
  /** Each version that could not be installed, named `<id>@<version>`; what runs is unaffected. */
  refused: StatusRefusal[];
  /** Whether the host stopped before the update finished; the next start resumes it. */
  interrupted: boolean;
  finished: boolean;
}

export interface UpdatePlan {
  sources: readonly CatalogSource[];
  cache: string;
  state: string;
  intervalHours: number;
  transport: CatalogTransport;
  fetcher: Fetcher;
  enabled: EnabledPlugin[];
  hostId: string;
  /** The versions this start runs, recorded again beside what the update schedules for the next. */
  run: Record<string, string>;
  /** Versions recorded as scheduled for the next start beside what the update schedules, so no sweep takes them. */
  kept?: Record<string, string>;
  /** Read once the update starts, after the plugins have started, so every damaged version has been met. */
  problems: () => BundleProblem[];
}

export interface UpdateTracker {
  progress(): UpdateProgress;
  stop(): Promise<void>;
}

type Target = { id: string; version: string };

function stopped(): CacheRefusal {
  return new CacheRefusal("the host stopped before this finished", "start the host again to resume the update");
}

/** @implNote Races each call with the stop signal, so a transport or fetcher that never answers cannot hold `stop` open. */
function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(stopped());
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function stoppable(plan: UpdatePlan, signal: AbortSignal): { transport: CatalogTransport; fetcher: Fetcher } {
  return {
    transport: { get: (url, etag) => untilStopped(plan.transport.get(url, etag), signal) },
    fetcher: { fetch: (url) => untilStopped(plan.fetcher.fetch(url), signal) },
  };
}

function targetsOf(plan: UpdatePlan, catalog: Catalog, problems: BundleProblem[]): Target[] {
  const scheduled = resolveVersions(catalog, plan.enabled, installedVersions(plan.cache)).fetch;
  const repairs = problems.map(({ id, version }) => ({ id, version }));
  const seen = new Set<string>();
  return [...repairs, ...scheduled].filter(({ id, version }) => {
    const key = `${id}@${version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nextOf(targets: Target[], run: Record<string, string>): Record<string, string> {
  return Object.fromEntries(targets.filter(({ id, version }) => !(Object.hasOwn(run, id) && run[id] === version)).map(({ id, version }) => [id, version]));
}

function itemOf(catalog: Catalog, id: string): CatalogItem | undefined {
  return Object.hasOwn(catalog.items, id) ? catalog.items[id] : undefined;
}

async function install(plan: UpdatePlan, catalog: Catalog, target: Target, fetcher: Fetcher, signal: AbortSignal, progress: UpdateProgress): Promise<void> {
  const name = `${target.id}@${target.version}`;
  const item = itemOf(catalog, target.id);
  if (item === undefined) {
    progress.refused.push({ id: name, detail: `no catalog source lists ${target.id}`, fix: "add a catalog source that lists it, or disable it" });
    return;
  }
  const answer = await installVersion(plan.cache, target.id, item, target.version, fetcher);
  if (answer.ok) progress.fetched.push(name);
  else if (!signal.aborted) progress.refused.push({ id: name, detail: answer.detail, fix: answer.fix });
}

async function update(plan: UpdatePlan, problems: BundleProblem[], signal: AbortSignal, progress: UpdateProgress): Promise<void> {
  const { transport, fetcher } = stoppable(plan, signal);
  for (const source of plan.sources) {
    const check = await checkCatalog(source, plan.cache, new Date(), plan.intervalHours, transport);
    if (signal.aborted) return;
    progress.checked.push(check);
  }
  const catalog = currentCatalogs(plan.sources, plan.cache);
  const targets = targetsOf(plan, catalog, problems);
  recordReferences(plan.state, plan.hostId, { run: plan.run, next: { ...plan.kept, ...nextOf(targets, plan.run) } });
  for (const target of targets) {
    if (signal.aborted) return;
    await install(plan, catalog, target, fetcher, signal, progress);
  }
  if (!signal.aborted) sweepCache(plan.cache, plan.state);
}

/**
 * Checks the catalog, fetches what the next start will run, repairs damaged versions and sweeps the
 * cache, all in the background of a start that already runs.
 */
export function startUpdates(plan: UpdatePlan): UpdateTracker {
  const controller = new AbortController();
  const progress: UpdateProgress = { checked: [], fetched: [], refused: [], interrupted: false, finished: false };
  const settled = update(plan, plan.problems(), controller.signal, progress)
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      progress.refused.push({ id: "updates", detail: (error as Error).message, fix: "start the host again to retry the update" });
    })
    .finally(() => {
      progress.interrupted = controller.signal.aborted;
      progress.finished = true;
    });
  return {
    progress: () => ({ ...progress, checked: [...progress.checked], fetched: [...progress.fetched], refused: [...progress.refused] }),
    stop: async () => {
      controller.abort();
      await settled;
    },
  };
}
