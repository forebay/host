import { CommandRefusal } from "../cli/command-refusal.js";
import { hostRunOf, readRegistration, readRegistrations, startFromCache } from "../cli/cache-session.js";
import type { CacheSession, HostRun } from "../cli/cache-session.js";
import { loaderIdentity } from "../install/loader-identity.js";
import { readInstalledStandard } from "../loader/installed-standard.js";
import type { LoaderStandard } from "../loader/standard.js";
import { backgroundHostStarter, holdBackgroundHost, releaseBackgroundHost } from "../processes/background.js";

/** Which version of a loader one start runs, and the `host.json` that version carries. */
export interface PreparedLoader {
  loaderId: string;
  run: HostRun;
  standard: LoaderStandard;
}

/** The `host.json` that version `version` of loader `loaderId` carries, refused with the reinstall fix when it is missing or invalid. */
export function standardOf(session: CacheSession, loaderId: string, version: string): LoaderStandard {
  const standard = readInstalledStandard(session.location.cache, loaderId, version);
  if (typeof standard !== "string") return standard;
  throw new CommandRefusal(standard, "run forebay-host install --catalog <path or url> again");
}

/** The loader's registration, the version its references schedule and that version's standard, every background host it names checked as registered. */
export function prepareLoader(session: CacheSession, loaderId: string): PreparedLoader {
  const run = hostRunOf(session, loaderId, readRegistration(session, loaderId).version);
  const standard = standardOf(session, loaderId, run.version);
  readRegistrations(session, standard.background);
  return { loaderId, run, standard };
}

async function releaseAll(state: string, held: readonly string[]): Promise<void> {
  for (const hostId of held) await releaseBackgroundHost(state, hostId);
}

/** Holds every background host in turn, releasing the ones already held when one cannot be. */
async function holdAll(session: CacheSession, background: readonly string[], environment: Record<string, string>): Promise<string[]> {
  const { cache } = session.location;
  const { state } = session.setup.places;
  const held: string[] = [];
  try {
    for (const hostId of background) {
      await holdBackgroundHost(state, hostId, backgroundHostStarter({ cache, directory: state, hostId, environment }));
      held.push(hostId);
    }
    return held;
  } catch (error) {
    await releaseAll(state, held);
    throw error;
  }
}

/**
 * Starts the prepared loader's host with the plugins its settings enable and holds each background
 * host its `host.json` names, answering the stop that drops the holds and then stops the host.
 */
export async function startLoaderSession(session: CacheSession, prepared: PreparedLoader, environment: Record<string, string>): Promise<() => Promise<void>> {
  const { loaderId, run, standard } = prepared;
  const identity = loaderIdentity({ id: loaderId, version: run.version, application: standard.application, pathCommands: standard.pathCommands, cache: session.location.cache, environment });
  const running = await startFromCache(session, identity, run, environment);
  let held: string[];
  try {
    held = await holdAll(session, standard.background, environment);
  } catch (error) {
    await running.stop();
    throw error;
  }
  return async () => {
    try {
      await releaseAll(session.setup.places.state, held);
    } finally {
      await running.stop();
    }
  };
}
