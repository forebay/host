import { currentPlatformKey } from "@weivel/typescript/host";
import type { BundleLocation } from "../../cache/bundle-location.js";
import { FOREBAY_HOST_ID, forebayHostIdentity } from "../../install/forebay-host.js";
import { bootLibraries, hostLibrariesOf, KOFFI_ID, recordBootLibraries, resolveHostLibraries, RUNTIME_ID, verifiedRuntimeSource } from "../../install/host-libraries.js";
import type { Provenance } from "../../registration.js";
import type { HostLibraries } from "../../runtime/cached-runtime.js";
import { startHostWith } from "../../start.js";
import { currentCatalogs } from "../../updates/current-catalogs.js";
import type { HostReferences } from "../../updates/references.js";
import { CommandRefusal } from "../command-refusal.js";
import { installedHostAt, readHostSetup } from "../installed-host.js";
import type { HostSetup } from "../installed-host.js";
import type { CommandLineOutput } from "../output.js";

function provenanceOf(location: BundleLocation): Provenance {
  return {
    method: "catalog",
    version: location.version,
    location: location.directory,
    os: process.platform,
    architecture: process.arch,
    installedAt: new Date().toISOString(),
  };
}

function loadedLibraries(location: BundleLocation): HostLibraries {
  const libraries = bootLibraries(location.cache, FOREBAY_HOST_ID, currentPlatformKey());
  if (libraries !== undefined) return libraries;
  throw new CommandRefusal(`no runtime and koffi are both installed for ${currentPlatformKey()} in ${location.cache}`, "run forebay-host install --catalog <path or url> again");
}

/** Resolves what the next start loads, records it, and answers the references that keep both it and what is loaded now. */
function resolveForNextStart(location: BundleLocation, loaded: HostLibraries, setup: HostSetup): HostReferences {
  const resolved = resolveHostLibraries(currentCatalogs(setup.sources, location.cache), setup.settings, location.cache, currentPlatformKey());
  const next = hostLibrariesOf(resolved);
  if (next !== undefined) recordBootLibraries(location.cache, FOREBAY_HOST_ID, next);
  const changed = Object.fromEntries(Object.entries(resolved).filter(([id, version]) => loaded[id as keyof HostLibraries] !== version));
  return { run: { [FOREBAY_HOST_ID]: location.version, [RUNTIME_ID]: loaded.runtime, [KOFFI_ID]: loaded.koffi }, next: changed };
}

/** Starts the installed host from the cache with no background check, prints its `HostStatus` as JSON, and stops it. */
export async function statusCommand(bundleFile: string, environment: Record<string, string>, output: CommandLineOutput): Promise<void> {
  const location = installedHostAt(bundleFile);
  const loaded = loadedLibraries(location);
  const source = verifiedRuntimeSource(location.cache, loaded, currentPlatformKey());
  const setup = readHostSetup(source, environment, location);
  const running = await startHostWith(
    {
      identity: forebayHostIdentity(setup.places, location.version),
      runtime: source,
      catalog: { sources: setup.sources, references: resolveForNextStart(location, loaded, setup) },
      provenance: provenanceOf(location),
      environment,
    },
    {},
    { checkUpdates: false },
  );
  try {
    output.out(JSON.stringify(running.status(), null, 2));
  } finally {
    await running.stop();
  }
}
