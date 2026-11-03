import type { BundleLocation } from "../cache/bundle-location.js";
import { hostLibraryReferences } from "../install/boot-from-cache.js";
import type { CacheBoot } from "../install/boot-from-cache.js";
import { FOREBAY_HOST_ID, forebayHostIdentity, forebayHostProvenance } from "../install/forebay-host.js";
import { startHostWith } from "../start.js";
import type { RunningHost } from "../start.js";
import { currentCatalogs } from "../updates/current-catalogs.js";
import type { HostReferences } from "../updates/references.js";
import { openCacheSession } from "./cache-session.js";
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
 * @remarks The cache's boot entry is rewritten when it differs from the one this bundle carries.
 *
 * @implNote The install registered the host, and the first registration wins, so the provenance
 * given here is used only for a host whose registration was lost.
 */
export async function startInstalledHost(bundleFile: string, environment: Record<string, string>): Promise<RunningHost> {
  const { location, boot, setup } = openCacheSession(bundleFile, environment);
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
