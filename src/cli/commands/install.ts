import { resolve } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { installBootEntry } from "../../boot/boot-install.js";
import { defaultFetcher } from "../../cache/fetcher.js";
import type { Catalog } from "../../catalog/catalog.js";
import type { CatalogSource } from "../../catalog/sources.js";
import { bootstrapLibraries } from "../../install/bootstrap-libraries.js";
import type { Bootstrap } from "../../install/bootstrap-libraries.js";
import { forebayHostHome } from "../../install/forebay-host.js";
import { KOFFI_ID, RUNTIME_ID, verifiedRuntimeSource } from "../../install/host-libraries.js";
import type { InstallReport } from "../../install/install-report.js";
import { installEcosystem } from "../../install/install-ecosystem.js";
import { installLoaders } from "../../install/install-loaders.js";
import type { InstallOptions } from "../../install/install-ecosystem.js";
import { ApplicationChoiceError, checkApplicationIds, parseApplicationChoices, resolveMissingApplications } from "../../install/missing-applications.js";
import type { MissingApplicationsHost, MissingApplicationsRequest } from "../../install/missing-applications.js";
import type { HostLibraries } from "../../runtime/cached-runtime.js";
import { CommandRefusal } from "../command-refusal.js";
import { UsageError } from "../command-line.js";
import { installedHostAt, readHostSetup } from "../installed-host.js";
import type { CommandLineOutput } from "../output.js";
import { startInstalledHost } from "../start-installed-host.js";
import { askOnTerminal } from "../terminal-question.js";
import type { AskQuestion } from "../terminal-question.js";

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export interface InstallArguments {
  catalog: string;
  plugins: string[];
  /** The `--application <id>=<method>` values, as given. */
  applications?: string[];
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

function asUsageError(error: unknown): unknown {
  return error instanceof ApplicationChoiceError ? new UsageError(error.message) : error;
}

function choicesOf(given: InstallArguments, catalog: Catalog): Record<string, string> {
  try {
    const choices = parseApplicationChoices(given.applications ?? []);
    checkApplicationIds(catalog, choices);
    return choices;
  } catch (error) {
    throw asUsageError(error);
  }
}

/** Offers the missing applications, a refused `--application` flag surfacing as a usage error rather than escaping the command line. */
export async function resolveApplicationsForCommand(request: MissingApplicationsRequest, host: MissingApplicationsHost, report: InstallReport): Promise<void> {
  try {
    await resolveMissingApplications(request, host, report);
  } catch (error) {
    throw asUsageError(error);
  }
}

/**
 * @implNote The installer never loads plugins, so the host is started from the cache here to run
 * detection and the install-method providers, and is stopped before the command returns. Installing
 * a provider mid-run stops the host, installs it, and starts the host again, because a running host
 * does not pick up a plugin installed after it started.
 */
function missingApplicationsHost(given: InstallArguments, options: InstallOptions, bundleFile: string, environment: Record<string, string>): MissingApplicationsHost {
  return {
    start: () => startInstalledHost(bundleFile, environment),
    installProvider: (id) => installEcosystem({ ...options, requested: [...given.plugins, id] }),
  };
}

/**
 * Installs the ecosystem from a catalog into the cache the running host is installed in, and prints
 * the report as JSON; each `--plugin` is installed and enabled whatever the settings say.
 *
 * @remarks The cache's boot entry is made the running bundle's. After the missing applications are resolved, every installed or detected application gets
 * its loader installed and registered as a host of its own.
 *
 * @implNote The runtime and koffi are installed first, beside the bundle, because the places are the
 * runtime's answer: only then can the runtime say where the settings are.
 */
export async function installCommand(
  given: InstallArguments,
  bundleFile: string,
  environment: Record<string, string>,
  output: CommandLineOutput,
  ask: AskQuestion = askOnTerminal,
): Promise<void> {
  const location = installedHostAt(bundleFile);
  const sources = [catalogSourceOf(given.catalog)];
  const fetcher = defaultFetcher();
  const bootstrap = await bootstrapLibraries(sources, location.cache, fetcher);
  const source = verifiedRuntimeSource(location.cache, librariesOf(bootstrap), currentPlatformKey());
  installBootEntry(location.cache, location.directory);
  const choices = choicesOf(given, bootstrap.catalog);
  const { places } = readHostSetup(source, environment, location);
  const options: InstallOptions = { catalog: sources, places, home: forebayHostHome(places), defaults: [], requested: given.plugins, fetcher, bootstrap };
  const report = await installEcosystem(options);
  if (report.unavailable.length === 0) {
    await resolveApplicationsForCommand({ catalog: bootstrap.catalog, environment, choices, ask }, missingApplicationsHost(given, options, bundleFile, environment), report);
    await installLoaders({ catalog: bootstrap.catalog, places, runtimeSource: source, fetcher, environment }, report);
  }
  output.out(JSON.stringify(report, null, 2));
  if (report.unavailable.length === 0) return;
  throw new CommandRefusal(`${report.unavailable.map(({ id }) => id).join(", ")} could not be installed`, "see each item's fix under unavailable above, then install again");
}
