import { resolve } from "node:path";
import { defaultFetcher } from "../../cache/fetcher.js";
import type { CatalogSource } from "../../catalog/sources.js";
import { forebayHostHome } from "../../install/forebay-host.js";
import { installEcosystem } from "../../install/install-ecosystem.js";
import { installFoundation, RUNTIME_ID } from "../../install/install-foundation.js";
import type { Foundation } from "../../install/install-foundation.js";
import { mergeReports } from "../../install/install-report.js";
import { cachedRuntime } from "../../runtime/cached-runtime.js";
import { CommandRefusal } from "../command-refusal.js";
import { UsageError } from "../command-line.js";
import { installedHostAt, readHostSetup } from "../installed-host.js";
import type { CommandLineOutput } from "../output.js";

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface InstallArguments {
  catalog: string;
  plugins: string[];
}

function catalogSourceOf(catalog: string): CatalogSource {
  if (catalog.startsWith("https://")) return { kind: "https", url: catalog };
  if (URL_SCHEME.test(catalog)) throw new UsageError(`--catalog ${catalog} is neither an https url nor a local path`);
  return { kind: "local", path: resolve(catalog) };
}

function runtimeVersionOf(foundation: Foundation): string {
  const version = foundation.versions[RUNTIME_ID];
  if (version !== undefined) return version;
  const refused = foundation.report.unavailable.find(({ id }) => id === RUNTIME_ID || id === "catalog");
  throw new CommandRefusal(`the runtime could not be installed: ${refused?.detail ?? "the catalog lists no runtime"}`, refused?.fix ?? "install from a catalog that lists the runtime library");
}

/**
 * Installs the ecosystem from a catalog into the cache the running host is installed in, and prints the report as JSON.
 *
 * @implNote The runtime and koffi are installed first, beside the bundle, because the places are the
 * runtime's answer: only then can the runtime say where the settings are.
 */
export async function installCommand(given: InstallArguments, bundleFile: string, environment: Record<string, string>, output: CommandLineOutput): Promise<void> {
  const location = installedHostAt(bundleFile);
  const sources = [catalogSourceOf(given.catalog)];
  const fetcher = defaultFetcher();
  const foundation = await installFoundation(sources, location.cache, fetcher);
  const { places } = readHostSetup(cachedRuntime(location.cache, runtimeVersionOf(foundation)), environment, location);
  const installed = await installEcosystem({ catalog: sources, places, home: forebayHostHome(places), defaults: given.plugins, fetcher });
  const report = mergeReports(foundation.report, installed);
  output.out(JSON.stringify(report, null, 2));
  if (report.unavailable.length === 0) return;
  throw new CommandRefusal(`${report.unavailable.map(({ id }) => id).join(", ")} could not be installed`, "see each item's fix under unavailable above, then install again");
}
