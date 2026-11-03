import { resolve } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { defaultFetcher } from "../../cache/fetcher.js";
import type { CatalogSource } from "../../catalog/sources.js";
import { bootstrapLibraries } from "../../install/bootstrap-libraries.js";
import type { Bootstrap } from "../../install/bootstrap-libraries.js";
import { forebayHostHome } from "../../install/forebay-host.js";
import { KOFFI_ID, RUNTIME_ID, verifiedRuntimeSource } from "../../install/host-libraries.js";
import { installEcosystem } from "../../install/install-ecosystem.js";
import type { HostLibraries } from "../../runtime/cached-runtime.js";
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

function librariesOf(bootstrap: Bootstrap): HostLibraries {
  if (bootstrap.libraries !== undefined) return bootstrap.libraries;
  const refused = bootstrap.report.unavailable.find(({ id }) => id === RUNTIME_ID || id === KOFFI_ID || id === "catalog");
  throw new CommandRefusal(
    `the runtime and koffi could not be installed: ${refused?.detail ?? "the catalog lists neither"}`,
    refused?.fix ?? "install from a catalog that lists the runtime and koffi libraries",
  );
}

/**
 * Installs the ecosystem from a catalog into the cache the running host is installed in, and prints
 * the report as JSON; each `--plugin` is installed and enabled whatever the settings say.
 *
 * @implNote The runtime and koffi are installed first, beside the bundle, because the places are the
 * runtime's answer: only then can the runtime say where the settings are.
 */
export async function installCommand(given: InstallArguments, bundleFile: string, environment: Record<string, string>, output: CommandLineOutput): Promise<void> {
  const location = installedHostAt(bundleFile);
  const sources = [catalogSourceOf(given.catalog)];
  const fetcher = defaultFetcher();
  const bootstrap = await bootstrapLibraries(sources, location.cache, fetcher);
  const source = verifiedRuntimeSource(location.cache, librariesOf(bootstrap), currentPlatformKey());
  const { places } = readHostSetup(source, environment, location);
  const report = await installEcosystem({ catalog: sources, places, home: forebayHostHome(places), defaults: [], requested: given.plugins, fetcher, bootstrap });
  output.out(JSON.stringify(report, null, 2));
  if (report.unavailable.length === 0) return;
  throw new CommandRefusal(`${report.unavailable.map(({ id }) => id).join(", ")} could not be installed`, "see each item's fix under unavailable above, then install again");
}
