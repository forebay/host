import type { BundleLocation } from "../../cache/bundle-location.js";
import { FOREBAY_HOST_ID, forebayHostIdentity } from "../../install/forebay-host.js";
import { KOFFI_ID, RUNTIME_ID } from "../../install/install-foundation.js";
import type { Provenance } from "../../registration.js";
import { cachedRuntime } from "../../runtime/cached-runtime.js";
import { startHost } from "../../start.js";
import { installedHostAt, installedLibrary, readHostSetup } from "../installed-host.js";
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

/** Starts the installed host from the cache, prints its `HostStatus` as JSON, and stops it. */
export async function statusCommand(bundleFile: string, environment: Record<string, string>, output: CommandLineOutput): Promise<void> {
  const location = installedHostAt(bundleFile);
  const versions = { [FOREBAY_HOST_ID]: location.version, [RUNTIME_ID]: installedLibrary(location, RUNTIME_ID), [KOFFI_ID]: installedLibrary(location, KOFFI_ID) };
  const source = cachedRuntime(location.cache, versions[RUNTIME_ID]);
  const { places, sources } = readHostSetup(source, environment, location);
  const running = await startHost({
    identity: forebayHostIdentity(places, location.version),
    runtime: source,
    catalog: { sources, references: versions },
    provenance: provenanceOf(location),
    environment,
  });
  try {
    output.out(JSON.stringify(running.status(), null, 2));
  } finally {
    await running.stop();
  }
}
