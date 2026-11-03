import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installBootEntry } from "../boot/boot-install.js";
import { hostDirectoryOutput } from "../build/built-directory.js";
import type { CatalogInput } from "../build/local-catalog.js";
import { defaultFetcher } from "../cache/fetcher.js";
import type { HostPlaces } from "../context/places.js";
import { forebayHostHome } from "../install/forebay-host.js";
import { installCatalog } from "../install/install-catalog.js";
import { installEcosystem } from "../install/install-ecosystem.js";
import { installLoaders } from "../install/install-loaders.js";
import { emptyReport } from "../install/install-report.js";
import { openRuntime, siblingRuntime } from "../runtime/open.js";
import { REPOSITORY_ROOT } from "./context.js";
import { ecosystemCatalog, placesEnvironment } from "./ecosystem-catalog.js";
import type { EcosystemCatalog } from "./ecosystem-catalog.js";

const FIXTURE_HOSTS = resolve(import.meta.dirname, "hosts");

export const LOADER_ID = "fixture-loader";
export const APPLICATION_ID = "fixture-app";
export const BACKGROUND_ID = "background-fixture";
export const SESSION_PLUGIN = "viewer";

export interface LaunchEcosystem {
  environment: Record<string, string>;
  places: HostPlaces;
}

function fixtureHostInput(workspace: string, id: string): CatalogInput {
  const directory = join(workspace, "hosts", id);
  mkdirSync(directory, { recursive: true });
  copyFileSync(join(FIXTURE_HOSTS, id, "host.json"), join(directory, "host.json"));
  writeFileSync(join(directory, "host.js"), "export {};\n");
  return { kind: "host", output: hostDirectoryOutput(directory) };
}

/** The ecosystem catalog with the fixture loader, whose `background` names the fixture background host, and that host. */
export function launchCatalog(workspace: string): Promise<EcosystemCatalog> {
  return ecosystemCatalog(workspace, [fixtureHostInput(workspace, LOADER_ID), fixtureHostInput(workspace, BACKGROUND_ID)]);
}

function placesOf(environment: Record<string, string>): HostPlaces {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    return runtime.places.resolve({ home: environment.HOME as string, environment });
  } finally {
    runtime.close();
  }
}

function writePortableSettings(places: HostPlaces, settings: Record<string, unknown>): void {
  const runtime = openRuntime(siblingRuntime(REPOSITORY_ROOT));
  try {
    for (const [key, value] of Object.entries(settings)) runtime.settings.set({ home: forebayHostHome(places), portable: places.portable, key, value, layer: "portable" });
  } finally {
    runtime.close();
  }
}

/**
 * Installs `catalog` into places under `base` the way `forebay-host install` does for a machine with
 * the fixture application, the fixture background host its loader names included, then writes
 * `settings` to the portable layer.
 */
export async function installLaunchEcosystem(base: string, catalog: EcosystemCatalog, settings: Record<string, unknown>): Promise<LaunchEcosystem> {
  const environment = placesEnvironment(base);
  const places = placesOf(environment);
  const sources = [{ kind: "local" as const, path: catalog.path }];
  const fetcher = defaultFetcher();
  await installEcosystem({ catalog: sources, places, home: forebayHostHome(places), defaults: [SESSION_PLUGIN], fetcher });
  installBootEntry(places.cache, join(places.cache, "bundles", "forebay-host", catalog.hostVersion));
  const report = { ...emptyReport(), applications: [{ id: APPLICATION_ID, state: "installed" as const }] };
  const installed = await installCatalog(sources, places.cache, report);
  await installLoaders({ catalog: installed, places, runtimeSource: siblingRuntime(REPOSITORY_ROOT), fetcher, environment }, report);
  if (report.unavailable.length > 0) throw new Error(`the launch ecosystem did not install: ${JSON.stringify(report.unavailable)}`);
  writePortableSettings(places, settings);
  return { environment, places };
}
