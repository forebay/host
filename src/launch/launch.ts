import { CommandRefusal } from "../cli/command-refusal.js";
import { openCacheSession } from "../cli/cache-session.js";
import { findOnPath } from "../loader/on-path.js";
import type { LoaderApplication } from "../loader/standard.js";
import { runApplication } from "./child.js";
import { prepareLoader, startLoaderSession } from "./session.js";

export interface LaunchRequest {
  loaderId: string;
  /** Everything after the loader id, given to the application unchanged. */
  applicationArguments: string[];
}

function applicationBinary(application: LoaderApplication, environment: Record<string, string>): string {
  const found = findOnPath(application.binary, environment);
  if (found !== undefined) return found;
  throw new CommandRefusal(
    `the ${application.label} binary ${application.binary} is not on the PATH`,
    `install ${application.label} so ${application.binary} is on the PATH, or run forebay-host install --catalog <path or url> to install it`,
  );
}

/**
 * Starts the loader's host, at the version its references schedule once installed, with the plugins
 * its settings enable, holds each background host its
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
  const prepared = prepareLoader(session, request.loaderId);
  const binary = applicationBinary(prepared.standard.application, environment);
  const stop = await startLoaderSession(session, prepared, environment);
  try {
    return await runApplication(binary, request.applicationArguments, environment);
  } finally {
    await stop();
  }
}
