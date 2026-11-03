import { installBootEntry } from "../boot/boot-install.js";
import type { BundleLocation } from "../cache/bundle-location.js";
import { bootFromCache } from "../install/boot-from-cache.js";
import type { CacheBoot } from "../install/boot-from-cache.js";
import { catalogProvenance, FOREBAY_HOST_ID } from "../install/forebay-host.js";
import type { HostIdentity } from "../identity.js";
import { openRuntime } from "../runtime/open.js";
import { startHost } from "../start.js";
import type { RunningHost } from "../start.js";
import { readHostReferences } from "../updates/references.js";
import { CommandRefusal } from "./command-refusal.js";
import { installedHostAt, readHostSetup } from "./installed-host.js";
import type { HostSetup } from "./installed-host.js";

/** Where the running host bundle is installed, the runtime and koffi it loads, and the places and catalog sources they give. */
export interface CacheSession {
  location: BundleLocation;
  boot: CacheBoot;
  setup: HostSetup;
}

/** What a host's registration records that a start from the cache needs. */
export interface RegisteredHostRecord {
  version: string;
  home: string;
  requiresCommand: boolean;
  application?: Record<string, unknown>;
}

function recordOf(registration: Record<string, unknown> | undefined): RegisteredHostRecord | undefined {
  if (registration === undefined || typeof registration.version !== "string" || typeof registration.home !== "string") return undefined;
  const application = registration.application as Record<string, unknown> | undefined;
  return { version: registration.version, home: registration.home, requiresCommand: registration.requiresCommand === true, ...(application === undefined ? {} : { application }) };
}

/**
 * Opens the cache the host bundle `bundleFile` is installed in: the boot entry is made this
 * bundle's, and the runtime and koffi the standalone host's boot hint names are verified.
 */
export function openCacheSession(bundleFile: string, environment: Record<string, string>): CacheSession {
  const location = installedHostAt(bundleFile);
  installBootEntry(location.cache, location.directory);
  const boot = bootFromCache(location.cache, FOREBAY_HOST_ID);
  return { location, boot, setup: readHostSetup(boot.runtime, environment, location) };
}

/** The registrations of `ids`, each refused with the fix to install again when it is missing. */
export function readRegistrations(session: CacheSession, ids: readonly string[]): Record<string, RegisteredHostRecord> {
  const runtime = openRuntime(session.boot.runtime);
  try {
    return Object.fromEntries(
      ids.map((id) => {
        const record = recordOf(runtime.registry.get({ places: session.setup.places, id }).registration as Record<string, unknown> | undefined);
        if (record === undefined) throw new CommandRefusal(`the host ${id} is not registered in ${session.setup.places.state}`, "run forebay-host install --catalog <path or url> again");
        return [id, record];
      }),
    );
  } finally {
    runtime.close();
  }
}

/** The registration of `id`, refused with the fix to install again when it is missing. */
export function readRegistration(session: CacheSession, id: string): RegisteredHostRecord {
  return readRegistrations(session, [id])[id] as RegisteredHostRecord;
}

/**
 * Starts `identity` from the cache with the plugins its settings enable, checking the catalog in the
 * background, and records the host bundle and libraries it runs as its references.
 *
 * @implNote The registration's first provenance wins, so the catalog provenance given here is used
 * only for a host whose registration was lost.
 */
export function startFromCache(session: CacheSession, identity: HostIdentity, environment: Record<string, string>): Promise<RunningHost> {
  const { location, boot, setup } = session;
  const run = { [identity.id]: identity.version, runtime: boot.libraries.runtime, koffi: boot.libraries.koffi };
  return startHost({
    identity,
    runtime: boot.runtime,
    catalog: { sources: setup.sources, references: { run, next: readHostReferences(setup.places.state, identity.id).next } },
    provenance: catalogProvenance(location.cache, identity.id, identity.version, new Date()),
    environment,
  });
}
