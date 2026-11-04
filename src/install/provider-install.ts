import type { LoaderApplication } from "../loader/standard.js";
import type { RunningHost } from "../start.js";
import { activeMethods, catalogProviders } from "./application-offers.js";
import type { CatalogProvider, MethodRefusal } from "./application-offers.js";
import type { InstallReport } from "./install-report.js";
import type { Catalog } from "../catalog/catalog.js";

/** How the install starts the host from the cache, and installs and enables one more plugin into it. */
export interface MissingApplicationsHost {
  start(): Promise<RunningHost>;
  installProvider(id: string): Promise<InstallReport>;
}

/** A running host that installing a provider replaces, and what that install adds to `report`. */
export interface ProviderSession {
  running: RunningHost | undefined;
  host: MissingApplicationsHost;
  report: InstallReport;
}

export type PlanStep = { kind: "install-provider"; providerId: string } | { kind: "install"; name: string; options?: object };

export function runningOf(session: ProviderSession): RunningHost {
  if (session.running === undefined) throw new Error("the host is not running");
  return session.running;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @implNote The runtime answers `{ "install-provider": <catalog entry> }` or `{ "install": { method, package } }`; anything else is refused rather than guessed at. */
export function readStep(step: Record<string, unknown>): PlanStep | undefined {
  const provider = step["install-provider"];
  if (isRecord(provider) && typeof provider.id === "string") return { kind: "install-provider", providerId: provider.id };
  const install = step.install;
  if (!isRecord(install) || !isRecord(install.package) || typeof install.package.name !== "string") return undefined;
  return { kind: "install", name: install.package.name, ...(isRecord(install.package.options) ? { options: install.package.options } : {}) };
}

export function planSteps(
  running: RunningHost,
  application: LoaderApplication,
  offered: string[],
  method: string,
  providers: CatalogProvider[],
): { steps: Array<Record<string, unknown>> } | MethodRefusal {
  try {
    return running.runtime.install.plan({
      places: running.places,
      item: application.id,
      manifestPackages: application.packages,
      methods: offered,
      chosen: method,
      installedProviders: activeMethods(running),
      catalog: providers.map((provider) => ({ ...provider })),
    });
  } catch (error) {
    return { method, detail: (error as Error).message, fix: "choose another method" };
  }
}

export async function installProviderStep(session: ProviderSession, providerId: string): Promise<MethodRefusal[]> {
  await runningOf(session).stop();
  session.running = undefined;
  const result = await session.host.installProvider(providerId);
  session.report.installed.push(...result.installed);
  session.report.enabled.push(...result.enabled);
  session.running = await session.host.start();
  return result.unavailable.map(({ detail, fix }) => ({ method: providerId, detail, fix }));
}

/**
 * Installs the provider of `method` from the catalog when no active plugin serves it, which stops
 * the host, installs and enables the provider, and starts the host again so the provider is loaded.
 *
 * @implNote Only the plan's `install-provider` step is carried out here; the plan's install step
 * is the caller's to run, through `operate`.
 */
export async function ensureProvider(session: ProviderSession, application: LoaderApplication, method: string, catalog: Catalog, platformKey: string): Promise<MethodRefusal | undefined> {
  if (activeMethods(runningOf(session)).includes(method)) return undefined;
  const planned = planSteps(runningOf(session), application, [method], method, catalogProviders(catalog, platformKey));
  if ("detail" in planned) return planned;
  for (const raw of planned.steps) {
    const step = readStep(raw);
    if (step?.kind !== "install-provider") continue;
    const refusals = await installProviderStep(session, step.providerId);
    if (refusals.length > 0) return { method, detail: refusals[0]?.detail ?? "", fix: refusals[0]?.fix ?? "" };
  }
  return undefined;
}
