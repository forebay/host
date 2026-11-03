import { CommandRefusal } from "../cli/command-refusal.js";
import { openCacheSession, readRegistration, readRegistrations, startFromCache } from "../cli/cache-session.js";
import type { CacheSession } from "../cli/cache-session.js";
import { loaderIdentity } from "../install/loader-identity.js";
import { readInstalledStandard } from "../loader/installed-standard.js";
import { findOnPath } from "../loader/on-path.js";
import type { LoaderApplication, LoaderStandard } from "../loader/standard.js";
import { backgroundHostStarter, holdBackgroundHost, releaseBackgroundHost } from "../processes/background.js";
import { runApplication } from "./child.js";

export interface LaunchRequest {
  loaderId: string;
  /** Everything after the loader id, given to the application unchanged. */
  applicationArguments: string[];
}

function standardOf(session: CacheSession, loaderId: string, version: string): LoaderStandard {
  const standard = readInstalledStandard(session.location.cache, loaderId, version);
  if (typeof standard !== "string") return standard;
  throw new CommandRefusal(standard, "run forebay-host install --catalog <path or url> again");
}

function applicationBinary(application: LoaderApplication, environment: Record<string, string>): string {
  const found = findOnPath(application.binary, environment);
  if (found !== undefined) return found;
  throw new CommandRefusal(
    `the ${application.label} binary ${application.binary} is not on the PATH`,
    `install ${application.label} so ${application.binary} is on the PATH, or run forebay-host install --catalog <path or url> to install it`,
  );
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

async function runHeld(session: CacheSession, standard: LoaderStandard, binary: string, request: LaunchRequest, environment: Record<string, string>): Promise<number> {
  const held = await holdAll(session, standard.background, environment);
  try {
    return await runApplication(binary, request.applicationArguments, environment);
  } finally {
    await releaseAll(session.setup.places.state, held);
  }
}

/**
 * Starts the loader's host with the plugins its settings enable, holds each background host its
 * `host.json` names, runs the application as this process's child, and answers the application's
 * exit code once the holds are dropped and the host has stopped.
 *
 * @remarks Everything that can be refused (no registration, no application on the PATH, a background
 * host never registered) is refused before anything starts, so a refusal leaves nothing running.
 * A launcher that is killed leaves the application running; each background host it held exits by
 * itself once no holder is alive.
 */
export async function launchCommand(request: LaunchRequest, bundleFile: string, environment: Record<string, string>): Promise<number> {
  const session = openCacheSession(bundleFile, environment);
  const loader = readRegistration(session, request.loaderId);
  const standard = standardOf(session, request.loaderId, loader.version);
  const binary = applicationBinary(standard.application, environment);
  readRegistrations(session, standard.background);
  const identity = loaderIdentity({ id: request.loaderId, version: loader.version, application: standard.application, pathCommands: standard.pathCommands, cache: session.location.cache, environment });
  const running = await startFromCache(session, identity, environment);
  try {
    return await runHeld(session, standard, binary, request, environment);
  } finally {
    await running.stop();
  }
}
