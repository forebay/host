import { join } from "node:path";
import { installBootEntry } from "../boot/boot-install.js";
import type { BundleLocation } from "../cache/bundle-location.js";
import { checkInstalled } from "../cache/install-marker.js";
import { bootFromCache, hostLibraryReferences } from "../install/boot-from-cache.js";
import type { CacheBoot } from "../install/boot-from-cache.js";
import { catalogProvenance, FOREBAY_HOST_ID } from "../install/forebay-host.js";
import type { HostIdentity } from "../identity.js";
import { openRuntime } from "../runtime/open.js";
import { startHost } from "../start.js";
import type { RunningHost } from "../start.js";
import { currentCatalogs } from "../updates/current-catalogs.js";
import { readHostReferences, recordReferences } from "../updates/references.js";
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

/** Which version of a host bundle one start runs, what stays scheduled after it, and what it switched away from. */
export interface HostRun {
  version: string;
  next: Record<string, string>;
  rollback: Record<string, string>;
}

function isInstalledBundle(cache: string, hostId: string, version: string): boolean {
  return checkInstalled(join(cache, "bundles", hostId, version)).kind === "intact";
}

function withoutId(versions: Record<string, string>, id: string): Record<string, string> {
  return Object.fromEntries(Object.entries(versions).filter(([key]) => key !== id));
}

/**
 * The version of host `hostId` this start runs: the one its references schedule for the next start
 * once that is installed intact, else the `registered` one (spec 7.2). A switch keeps the version
 * switched from for rollback until a later start.
 */
export function hostRunOf(session: CacheSession, hostId: string, registered: string): HostRun {
  const recorded = readHostReferences(session.setup.places.state, hostId);
  const scheduled = recorded.next[hostId];
  const switching = scheduled !== undefined && scheduled !== registered && isInstalledBundle(session.location.cache, hostId, scheduled);
  const version = switching ? scheduled : registered;
  const next = scheduled === version ? withoutId(recorded.next, hostId) : recorded.next;
  return { version, next, rollback: switching ? { [hostId]: registered } : {} };
}

/**
 * Records, as a start of the standalone host does, the host bundle and libraries this process runs
 * under the standalone host's references, and the libraries and host version its next start loads in
 * its boot hint, which every command and background host boots through.
 */
function recordStandaloneHost(session: CacheSession): void {
  const { location, boot, setup } = session;
  const { state } = setup.places;
  const resolved = hostLibraryReferences({
    cache: location.cache,
    state,
    hostId: FOREBAY_HOST_ID,
    catalog: currentCatalogs(setup.sources, location.cache),
    settings: setup.settings,
    loaded: boot.libraries,
    running: { [FOREBAY_HOST_ID]: location.version },
  });
  const recorded = readHostReferences(state, FOREBAY_HOST_ID);
  recordReferences(state, FOREBAY_HOST_ID, { ...recorded, run: { ...recorded.run, ...resolved.run }, next: resolved.next });
}

/**
 * Starts `identity` at `run`'s version from the cache with the plugins its settings enable, checking
 * the catalog in the background, and records the host bundles and libraries it runs as its
 * references, the standalone host's included.
 *
 * @implNote The registration's first provenance wins, so the catalog provenance given here is used
 * only for a host whose registration was lost.
 */
export function startFromCache(session: CacheSession, identity: HostIdentity, run: HostRun, environment: Record<string, string>): Promise<RunningHost> {
  const { location, boot, setup } = session;
  recordStandaloneHost(session);
  const running = { [identity.id]: run.version, [FOREBAY_HOST_ID]: location.version, runtime: boot.libraries.runtime, koffi: boot.libraries.koffi };
  return startHost({
    identity: { ...identity, version: run.version },
    runtime: boot.runtime,
    catalog: { sources: setup.sources, references: { run: running, next: run.next, rollback: run.rollback } },
    provenance: catalogProvenance(location.cache, identity.id, run.version, new Date()),
    environment,
  });
}
