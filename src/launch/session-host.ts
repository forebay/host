import { openCacheSession } from "../cli/cache-session.js";
import { prepareLoader, startLoaderSession } from "./session.js";

/** A loader's host running inside the application's own process for the application's session. */
export interface SessionHost {
  stop(): Promise<void>;
}

/**
 * Starts the loader's host in this process, as `launch` does but with no application to run,
 * because this process is the application: for an application whose plugin entry lives for the
 * whole session.
 *
 * @implNote The host is stopped when the process exits, since the application offers its plugin no
 * dispose hook. An exit runs only the synchronous start of the stop, so a background host this
 * session held exits by itself once it sees no live holder, as it does for a killed launcher.
 */
export async function sessionHostCommand(loaderId: string, bundleFile: string, environment: Record<string, string>): Promise<SessionHost> {
  const session = openCacheSession(bundleFile, environment);
  const stopSession = await startLoaderSession(session, prepareLoader(session, loaderId), environment);
  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= stopSession());
  const stopOnExit = () => void stop();
  process.once("exit", stopOnExit);
  return {
    stop: () => {
      process.off("exit", stopOnExit);
      return stop();
    },
  };
}
