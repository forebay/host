import type { BundleLocation } from "../cache/bundle-location.js";
import { bootFromCache, hostLibraryReferences } from "../install/boot-from-cache.js";
import type { CacheBoot } from "../install/boot-from-cache.js";
import { FOREBAY_HOST_ID, forebayHostIdentity, forebayHostProvenance } from "../install/forebay-host.js";
import { startHostWith } from "../start.js";
import type { RunningHost } from "../start.js";
import { currentCatalogs } from "../updates/current-catalogs.js";
import type { HostReferences } from "../updates/references.js";
import { installedHostAt, readHostSetup } from "./installed-host.js";
import type { HostSetup } from "./installed-host.js";

function referencesFor(location: BundleLocation, boot: CacheBoot, setup: HostSetup): HostReferences {
  return hostLibraryReferences({
    cache: location.cache,
    state: setup.places.state,
    hostId: FOREBAY_HOST_ID,
    catalog: currentCatalogs(setup.sources, location.cache),
    settings: setup.settings,
    loaded: boot.libraries,
    running: { [FOREBAY_HOST_ID]: location.version },
  });
}

/**
 * Starts the installed host from the cache with no background check, for a one-shot command that
 * reports and stops it.
 *
 * @implNote The install registered the host, and the first registration wins, so the provenance
 * given here is used only for a host whose registration was lost.
 */
export async function startInstalledHost(bundleFile: string, environment: Record<string, string>): Promise<RunningHost> {
  const location = installedHostAt(bundleFile);
  const boot = bootFromCache(location.cache, FOREBAY_HOST_ID);
  const setup = readHostSetup(boot.runtime, environment, location);
  return startHostWith(
    {
      identity: forebayHostIdentity(setup.places, location.version),
      runtime: boot.runtime,
      catalog: { sources: setup.sources, references: referencesFor(location, boot, setup) },
      provenance: forebayHostProvenance(location.cache, location.version, new Date()),
      environment,
    },
    {},
    { checkUpdates: false },
  );
}
