import { realpathSync } from "node:fs";
import { join } from "node:path";
import { currentPlatformKey } from "@weivel/typescript/host";
import { bundleLocationOf } from "../cache/bundle-location.js";
import type { BundleLocation } from "../cache/bundle-location.js";
import { newestInstalledLibrary } from "../cache/installed-library.js";
import type { CatalogSource } from "../catalog/sources.js";
import { readCatalogSources } from "../catalog/sources.js";
import type { HostPlaces } from "../context/places.js";
import { hostSettings } from "../host-settings.js";
import { forebayHostHome } from "../install/forebay-host.js";
import { openRuntime } from "../runtime/open.js";
import type { RuntimeSource } from "../runtime/open.js";
import { userHomeOf } from "../user-home.js";
import { CommandRefusal } from "./command-refusal.js";

/** The places the runtime resolves, and the catalog sources the standalone host's settings name. */
export interface HostSetup {
  places: HostPlaces;
  sources: CatalogSource[];
}

function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** Where the running host bundle is installed, refused when it is not inside a cache. */
export function installedHostAt(bundleFile: string): BundleLocation {
  const location = bundleLocationOf(bundleFile);
  if (location !== undefined) return location;
  throw new CommandRefusal(`${bundleFile} is not installed in a cache, so the runtime and koffi cannot be found beside it`, "run the host from <cache>/bundles/<id>/<version>/");
}

/** The newest completed install of library `id` for this platform, refused when there is none. */
export function installedLibrary(location: BundleLocation, id: string): string {
  const version = newestInstalledLibrary(location.cache, id, currentPlatformKey());
  if (version !== undefined) return version;
  throw new CommandRefusal(`no ${id} is installed for ${currentPlatformKey()} in ${join(location.cache, "libraries", id)}`, "run forebay-host install --catalog <path or url> again");
}

/**
 * @implNote The runtime and koffi were found beside the bundle, so the places must name that same
 * cache, or the host would read one cache and install into another.
 */
function assertSameCache(places: HostPlaces, location: BundleLocation): void {
  if (realPath(places.cache) === realPath(location.cache)) return;
  throw new CommandRefusal(`the host is installed in ${location.cache}, but the places name the cache ${places.cache}`, "run the host installed in the cache SPISOR_CACHE names, or set SPISOR_CACHE to the cache holding it");
}

/** Opens the runtime once to resolve the places and read the catalog sources the host's settings name. */
export function readHostSetup(source: RuntimeSource, environment: Record<string, string>, location: BundleLocation): HostSetup {
  const runtime = openRuntime(source);
  try {
    const places = runtime.places.resolve({ home: userHomeOf(environment), environment });
    assertSameCache(places, location);
    return { places, sources: readCatalogSources(hostSettings(runtime, places, forebayHostHome(places)).all()).sources };
  } finally {
    runtime.close();
  }
}
