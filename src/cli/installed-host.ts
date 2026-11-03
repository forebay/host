import { realpathSync } from "node:fs";
import { bundleLocationOf } from "../cache/bundle-location.js";
import type { BundleLocation } from "../cache/bundle-location.js";
import type { CatalogSource } from "../catalog/sources.js";
import { readCatalogSources } from "../catalog/sources.js";
import type { HostPlaces } from "../context/places.js";
import { hostSettings } from "../host-settings.js";
import { forebayHostHome } from "../install/forebay-host.js";
import { openRuntime } from "../runtime/open.js";
import type { RuntimeSource } from "../runtime/open.js";
import { userHomeOf } from "../user-home.js";
import { CommandRefusal } from "./command-refusal.js";

/** The places the runtime resolves, and the standalone host's settings with the catalog sources they name. */
export interface HostSetup {
  places: HostPlaces;
  settings: Record<string, unknown>;
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

/**
 * @implNote The runtime and koffi were found beside the bundle, so the places must name that same
 * cache, or the host would read one cache and install into another.
 */
function assertSameCache(places: HostPlaces, location: BundleLocation): void {
  if (realPath(places.cache) === realPath(location.cache)) return;
  throw new CommandRefusal(`the host is installed in ${location.cache}, but the places name the cache ${places.cache}`, "run the host installed in the cache SPISOR_CACHE names, or set SPISOR_CACHE to the cache holding it");
}

/** Opens the runtime once to resolve the places and read the host's settings. */
export function readHostSetup(source: RuntimeSource, environment: Record<string, string>, location: BundleLocation): HostSetup {
  const runtime = openRuntime(source);
  try {
    const places = runtime.places.resolve({ home: userHomeOf(environment), environment });
    assertSameCache(places, location);
    const settings = hostSettings(runtime, places, forebayHostHome(places)).all();
    return { places, settings, sources: readCatalogSources(settings).sources };
  } finally {
    runtime.close();
  }
}
