import { CommandRefusal } from "../cli/command-refusal.js";
import { hostRunOf, readRegistration, readRegistrations, startFromCache } from "../cli/cache-session.js";
import type { CacheSession, HostRun } from "../cli/cache-session.js";
import type { HostIdentity } from "../identity.js";
import { loaderIdentity } from "../install/loader-identity.js";
import { readInstalledStandard } from "../loader/installed-standard.js";
import type { LoaderStandard } from "../loader/standard.js";
import { backgroundHostStarter, holdBackgroundHost, releaseBackgroundHost } from "../processes/background.js";
import { openRuntime } from "../runtime/open.js";

/** Which version of a loader one start runs, and the `host.json` that version carries. */
export interface PreparedLoader {
  loaderId: string;
  run: HostRun;
  standard: LoaderStandard;
}

/** A started loader session: how to make another process a holder of its background hosts, and how to stop it. */
export interface LoaderSession {
  /** Makes `pid` a holder of every background host this session holds, answering how to drop it again. */
  holdFor(pid: number): Promise<() => Promise<void>>;
  stop(): Promise<void>;
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

function identityOf(session: CacheSession, prepared: PreparedLoader, environment: Record<string, string>): HostIdentity {
  const { loaderId, run, standard } = prepared;
  const runtime = openRuntime(session.boot.runtime);
  try {
    return loaderIdentity(runtime, { id: loaderId, version: run.version, application: standard.application, pathCommands: standard.pathCommands, places: session.setup.places, environment });
  } finally {
    runtime.close();
  }
}

async function releaseAll(state: string, held: readonly string[], holder: number): Promise<void> {
  for (const hostId of held) await releaseBackgroundHost(state, hostId, holder);
}

/** Holds every background host in turn for `holder`, releasing the ones already held when one cannot be. */
async function holdAll(session: CacheSession, background: readonly string[], environment: Record<string, string>, holder: number): Promise<string[]> {
  const { cache } = session.location;
  const { state } = session.setup.places;
  const held: string[] = [];
  try {
    for (const hostId of background) {
      await holdBackgroundHost(state, hostId, backgroundHostStarter({ cache, directory: state, hostId, environment }), holder);
      held.push(hostId);
    }
    return held;
  } catch (error) {
    await releaseAll(state, held, holder);
    throw error;
  }
}

/**
 * Starts the prepared loader's host with the plugins its settings enable and holds each background
 * host its `host.json` names, answering the session whose stop drops the holds and then stops the host.
 */
export async function startLoaderSession(session: CacheSession, prepared: PreparedLoader, environment: Record<string, string>): Promise<LoaderSession> {
  const { state } = session.setup.places;
  const { background } = prepared.standard;
  const running = await startFromCache(session, identityOf(session, prepared, environment), prepared.run, environment);
  let held: string[];
  try {
    held = await holdAll(session, background, environment, process.pid);
  } catch (error) {
    await running.stop();
    throw error;
  }
  return {
    holdFor: async (pid) => {
      const heldFor = await holdAll(session, background, environment, pid);
      return () => releaseAll(state, heldFor, pid);
    },
    stop: async () => {
      try {
        await releaseAll(state, held, process.pid);
      } finally {
        await running.stop();
      }
    },
  };
}
