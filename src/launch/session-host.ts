import { openCacheSession } from "../cli/cache-session.js";
import { prepareLoader, startLoaderSession } from "./session.js";

const STOP_FIX = "nothing is needed now; a background host this session held exits by itself once it sees no live holder";

/** A loader's host running inside the application's own process for the application's session. */
export interface SessionHost {
  stop(): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The listener that stops the session host as its process exits.
 *
 * @implNote The process is the application's, so a stop that fails is written to stderr, never left
 * as an unhandled rejection that would take the application down or print where it parses.
 */
export function exitStopper(stop: () => Promise<void>, writeError: (text: string) => void): () => void {
  return () => {
    stop().catch((error: unknown) => writeError(`spisor could not stop the session host: ${messageOf(error)}\nfix: ${STOP_FIX}\n`));
  };
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
  const stopOnExit = exitStopper(stop, (text) => process.stderr.write(text));
  process.once("exit", stopOnExit);
  return {
    stop: () => {
      process.off("exit", stopOnExit);
      return stop();
    },
  };
}
